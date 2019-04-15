function title(){
console.log(`
d88888b d8888b.  .o88b. .d888b.  db .d888b.     d8888b.  .d88b.   .d88b.  db      
88'     88   8D d8P  Y8 88'  8D o88 88   8D     88   8D .8P  Y8. .8P  Y8. 88      
88ooooo 88oobY' 8P       V8o88'  88  VoooY'     88oodD' 88    88 88    88 88      
88~~~~~ 88 8b   8b         d8'   88 .d~~~b.     88~~~   88    88 88    88 88      
88.     88  88. Y8b  d8   d8'    88 88   8D     88       8b  d8'  8b  d8' 88booo. 
Y88888P 88   YD   Y88P'  d8'     VP  Y888P'     88        Y88P'    Y88P'  Y88888P 
`)}

const express = require('express')
const basicAuth = require('basic-auth-connect')
const schedule = require('node-schedule')
const fetch = require('node-fetch')
const fs = require('fs')
const mongodb = require('mongodb')
const ObjectId = mongodb.ObjectId
const Web3 = require('web3')
var web3
const util = require('./lib/util')
const vault = require('./lib/vault')
const mineable = require('./lib/mineable-interface')

const INVALID_STATUS = 'INVALID'
const VALID_STATUS = 'VALID'

console.log(process.env.TITLE + ' version ' + process.env.VERSION)
if(process.env.TEST_MODE === true) console.log('-- Running in TEST MODE --')

var app = express()

var MongoClient = mongodb.MongoClient;
var dbo
var poolAccount

// start up the app
app.listen(process.env.PORT, async() => {
	console.log(process.env.TITLE + ' version ' + process.env.VERSION)
    // force login/setup
    title()
    
    // initialize objects
    web3 = new Web3(process.env.ETHEREUM_PROVIDER_URL)
    //web3.setProvider(process.env.ETHEREUM_PROVIDER_URL)
    util.init(web3)
	
	let res = await vault.init(web3)
	if(res == false) {
		process.exit()
	}	
	poolAccount = res.account

	console.log('Pool address: ' + poolAccount.address)

	await mineable.init(web3, poolAccount)

	var url = res.url

    MongoClient.connect(res.url, { useNewUrlParser: true }, function(err, db) {
	  if (err) throw err;
	  dbo = db.db(process.env.MONGO_DB)
	  // prune out older records
	  /*
	  util.prune(dbo)
	  setInterval( () => util.prune(dbo), process.env.AUTOPRUNE_INTERVAL_MINUTES * 1000 * 60)
	  */

	  // payouts schedule
	  schedule.scheduleJob(process.env.PAYOUTS_CRON, async function(){
	    console.log('Prcoessing payouts...')
	    await util.processPayouts(dbo, poolAccount, mineable)
	    console.log('Payouts complete.')
	  })
	})

})

var admin = express()
// serve static html
app.use(express.static('public'))
// mount the admin app
app.use('/admin', admin)
admin.use(basicAuth('admin', process.env.ADMIN_PASSWORD))
app.use(express.json())
app.set('json spaces', 2)
app.use(function(err, req, res, next) {
  console.error(err.stack)
  res.status(500).send(err.stack)
})

// wrap catches for asyn calls
const asyncMiddleware = fn =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next))
      .catch(next);
}

// displays title and information about the service
app.get('/settings', function (request, response) {
  // response.json(process.env.TITLE + ' version ' + process.env.VERSION)
  response.json(util.config())
})

// Account summary
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/account/0xaddress
app.get('/account/:account', asyncMiddleware( async (request, response, next) => {
	let results = {}
	let totalResults = await dbo.collection('payouts').aggregate(
		[
		    {
			  $match: {
				   account: { $eq: request.params.account },
			  } 
			},
		    {
			  $group : {
			       _id : { account: '$account', contract: '$contract' },
			       total: { $sum: '$payout' },
			  }
		  	}
		]
	).toArray()

	var total = 0
	if(totalResults[0]){	
		total = totalResults[0].total
	}

	let unpaidResults = await dbo.collection('payouts').aggregate(
		[
		    {
			  $match: {
				   account: { $eq: request.params.account },
				   payoutTxn: { $exists: false }
			  } 
			},
		    {
			  $group : {
			       _id : { account: '$account', contract: '$contract' },
			       unpaid: { $sum: '$payout' },
			  }
		  	}
		]
	).toArray()

	results = totalResults
	if(unpaidResults[0]) {
		results[0].paid = total - unpaidResults[0].unpaid
		results[0].unpaid = unpaidResults[0].unpaid
	} else {
		results[0].paid = total
		results[0].unpaid = 0
	}

	response.json(results)

}))

// View all payouts given out by this pool
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/payouts
app.get('/payouts', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({}).toArray()
    response.json(res)
}))

// View all payouts given to this account
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/payouts/0xaccount
app.get('/payouts/:account', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({ account: request.params.account }).toArray()
    response.json(res)
}))

// request a share to solve
// curl -d '{"origin":"0xaddress", "contract": "0xcontract", "vardiff": 65536}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/request
app.post('/share/request', asyncMiddleware( async (request, response, next) => {
	if(!request.body.contract || !request.body.origin) {
		throw 'Invalid reqest body: ' + request.body
	}
	
	let p = await dbo.collection('shares').findOne({origin: request.body.origin, contract: request.body.contract, finish:{$eq: null}})
	
	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	packet.contract = request.body.contract

	if(request.body.contract != process.env.TARGET_CONTRACT) {
		throw 'Invalid target contract, this pool mines against: ' + process.env.TARGET_CONTRACT
	}

	if(request.body.vardiff && request.body.vardiff > process.env.MINIMUM_SHARE_DIFFICULTY) {
		packet.difficulty = parseInt(request.body.vardiff)
	} else {
		packet.difficulty = parseInt(process.env.MINIMUM_SHARE_DIFFICULTY)
	}
	packet.challengeNumber = await mineable.getChallengeNumber(packet.request.contract)
	packet.start = new Date().getTime()
	packet.finish = null
	let res = await dbo.collection('shares').insertOne(packet)
    response.json(packet)
}))

// submit a solved share
// curl -d '{ "uid": "theUUID", "nonce":"0xdeadbeef", "origin": "0xaddress", "signature": "0xsig"}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/submit
app.post('/share/submit', asyncMiddleware( async (request, response, next) => {

	var found = await dbo.collection('submitted').findOne({'nonce': request.body.nonce})
	if(found) {
		console.log('solution has already been submitted')
		throw 'solution has already been submitted'
	}
  	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	var p = await dbo.collection('shares').findOne(ObjectId(packet.request.uid))
	// let p = await dbo.collection('shares').findOne({origin: request.body.origin, contract: request.body.contract, finish:{$eq: null}})
	if( !p ) {
		throw 'Could not find share with uid: ' + packet.request.uid
	}

	if(p.contract != process.env.TARGET_CONTRACT) {
		throw 'Invalid target contract, this pool mines against: ' + process.env.TARGET_CONTRACT
	}
	// validate the share
	if( util.validate(p.challengeNumber, pRequest.origin, pRequest.nonce, p.difficulty) !== true ) {
		throw 'Invalid nonce submitted'
	}

	p.status = VALID_STATUS
	p.finish = new Date().getTime()
	var dif = p.finish - p.start
	var seconds = Math.round( dif / 1000 )
	p.seconds = seconds > 0 ? seconds : 1
	p.hashrate = util.estimatedShareHashrate(p.difficulty, p.seconds)

	// share counter
	let counter = await dbo.collection('sharecount').findOne( {_id: { origin: p.origin, challengeNumber: p.challengeNumber} } )
	if( !counter ) {
		counter = {}
		counter._id = {origin: p.origin, challengeNumber: p.challengeNumber}
		counter.challengeNumber = p.challengeNumber
		counter.count = parseInt(p.difficulty)
		counter.vcount = await util.getVirtualDifficulty(p.origin, p.contract)
		await dbo.collection('sharecount').insertOne(counter)
	} else {
		counter.count += parseInt(p.difficulty)
		// note virtual diff is not accumulated, since it is based on block time
		counter.vcount = await util.getVirtualDifficulty(p.origin, p.contract)
		await dbo.collection('sharecount').findOneAndUpdate( {_id: { origin: p.origin, challengeNumber: p.challengeNumber} }, { $set: counter }, { upsert: true } )
	}

	// check if the solution solves a token block
	let validBlock = await util.validateBlock(mineable, p.contract, p.origin, pRequest.nonce)
	if ( validBlock === true ) {
		try {
			console.log('-- Found block -- ')
			console.log( JSON.stringify(pRequest, 0, 2) )
			let dmResults = await mineable.delegatedMint( poolAccount, pRequest.nonce, p.origin, pRequest.signature, p.contract )
			console.log('dmResults: ' + dmResults)
		    let txnId = dmResults.transactionHash
			let payouts = await util.snapPayout(dbo, txnId, p.contract, mineable, p.challengeNumber)
			if(payouts.length > 0) { 
				await dbo.collection('payouts').insertMany(payouts)
			}
			// clear out all submitted shares for challenge
			await dbo.collection('shares').deleteMany({challengeNumber: p.challengeNumber})
		} catch(e) {
			console.log(e)
		}
	}
	await dbo.collection('submitted').insertOne({'nonce': request.body.nonce})
	// now delete the share, since its been acounted for
	await dbo.collection('shares').deleteOne( { _id: ObjectId(request.body.uid) } )
	response.json(p)

	
	
}))

app.get('/submitted', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('submitted').find({}).toArray()
    response.json(res)
}))

// Get the hashrate share for an account
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/blockshares
app.get('/blockshares', asyncMiddleware( async (request, response, next) => {
	// let res = await dbo.collection('sharecount').find({}).toArray()
    let res = await util.sharesCurrent(dbo, mineable, process.env.TARGET_CONTRACT)
    response.json(res)
}))

// Get the blockshares share for a challengeNumber
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/blockshares/challenge/0xchallengeNumber
app.get('/blockshares/challenge/:challengeNumber', asyncMiddleware( async (request, response, next) => {
	let docs = await util.sharesForChallenge(dbo, request.params.challengeNumber)
    response.json(docs)
}))

// Get the hashrate share for an account
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/blockshares/account/0xaddress
app.get('/blockshares/account/:account', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('sharecount').find({ _id: request.params.account }).toArray()
    response.json(res)
}))

// list archive
app.get('/archive', asyncMiddleware( async (request, response, next) => {
	let docs = await dbo.collection('archive').find({}).toArray()
    response.json(docs)
}))

//  --- admin functions ---
admin.get('/', asyncMiddleware( (request, response, next) => {
	response.json('hello admin')
}))

// prune the db
admin.get('/prune', asyncMiddleware( async (request, response, next) => {
	util.prune(dbo)
	response.json('done')
}))

// admin payout all
admin.get('/payout/all', asyncMiddleware( async (request, response, next) => {
	console.log('Prcoessing payouts...')
	util.processPayouts(dbo, poolAccount, mineable)
	console.log('Payouts complete.')
}))

// admin payout single
admin.get('/payout/:account', asyncMiddleware( async (request, response, next) => {
	await util.processPayoutSingle(dbo, poolAccount, mineable, request.params.account)
    response.json('done')
}))

// Get the blockshares share for a challengeNumber
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/blockshares/0xchallengeNumber
admin.get('/blockshares', asyncMiddleware( async (request, response, next) => {
	let docs = await dbo.collection('shares').find({}).toArray()
    response.json(docs)
}))
