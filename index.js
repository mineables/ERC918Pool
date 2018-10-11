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
var web3 = new Web3()
const util = require('./lib/util')
const vault = require('./lib/vault')
const mineable = require('./lib/mineable-interface')

const INVALID_STATUS = 'INVALID'
const VALID_STATUS = 'VALID'

console.log(process.env.TITLE + ' version ' + process.env.VERSION)
if(process.env.TEST_MODE) { console.log('-- Running in TEST MODE --') }

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
    web3.setProvider(process.env.ETHEREUM_PROVIDER_URL)
    util.init(web3)
	await mineable.init(web3)
	let res = await vault.init(web3)
	if(res == false) {
		process.exit()
	}	
	this.poolAccount = res.account

	console.log('Pool address: ' + this.poolAccount.address)

	var url = res.url

    MongoClient.connect(res.url, { useNewUrlParser: true }, function(err, db) {
	  if (err) throw err;
	  dbo = db.db(process.env.MONGO_DB)
	  // prune out older records
	  util.prune(dbo)
	  setInterval( () => util.prune(dbo), process.env.AUTOPRUNE_INTERVAL_MINUTES * 1000 * 60)

	  // payouts schedule
	  schedule.scheduleJob(process.env.PAYOUTS_CRON, function(){
	    console.log('Prcoessing payouts...')
	    util.processPayouts(dbo, this.poolAccount, mineable)
	    console.log('Payouts complete.')
	  })
	})

})

var admin = express()
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
app.get('/', function (request, response) {
  // response.json(process.env.TITLE + ' version ' + process.env.VERSION)
  response.json(util.config())
})

// View all submission transactions for an account share
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/mint/0xaddress
app.get('/mint/account/:account', asyncMiddleware( async (request, response, next) => {
  let res = await dbo.collection('transactions').find({ origin: request.params.account }).toArray()
  response.json(res)
}))

// Get a single mint transaction by Ethereum txn hash
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/mint/0xaddress
app.get('/mint/tx/:txnId', asyncMiddleware( async (request, response, next) => {
  let res = await dbo.collection('transactions').find({ txnId: request.params.txnId }).toArray()
  response.json(res)

}))

// ERC918 - Mineable Mint Packet Metadata
// submit a solution mint packet to be processed
// curl -d '{"nonce": "0xnonce", "origin": "0xaddress", "signature": "0xsignature"}' -H "Content-Type: application/json" http://127.0.0.1:3000/mint/0x...
app.post('/mint/:contract', asyncMiddleware( async (request, response, next) => {
	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
    // attach additional metadata to the packet
    packet.origin = pRequest.origin
    packet.timestamp = new Date()

    packet.delegate = this.poolAccount.address
    packet.txnId = ( await mineable.delegatedMint( this.poolAccount, pRequest.nonce, pRequest.origin, pRequest.signature, request.params.contract) ).transactionHash
    packet.hashrate = await util.accountHashrate( dbo, pRequest.origin )
    packet.ipfsPin = ( await util.ipfsPin(packet) ).Hash
	let res = await dbo.collection('transactions').insertOne(packet)

	let payouts = await util.snapPayout(dbo, packet.txnId, request.params.contract, mineable)
	if(payouts.length > 0) { 
		await dbo.collection('payouts').insertMany(payouts)
	}
	response.json(packet)
}))

// View all payouts given out by this pool
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/payouts
app.get('/payouts', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({}).toArray()
    response.json(res)
}))

// View all payouts given out by this pool
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/payouts/0xaccount..
app.get('/payouts/:account', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({ account: request.params.account }).toArray()
    response.json(res)
}))

app.get('/test/snapPayout', asyncMiddleware( async (request, response, next) => {
	let payouts = await util.snapPayout('0xdeadbeef')
	response.json( payouts )
}))

// request a share to solve
// curl -d '{"origin":"0xaddress", "contract": "0xcontract"}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/request
app.post('/share/request', asyncMiddleware( async (request, response, next) => {
	
	let p = await dbo.collection('shares').findOne({origin: request.body.origin, 'request.contract': request.body.contract, finish:{$ne: null}})
	if (p) {
		// only allow one share at a time per user per contract to be mined
		throw 'only allowed to process one share per account per contract'
	}

	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	packet.difficulty = process.env.DEFAULT_SHARE_DIFFICULTY
	packet.challengeNumber = await mineable.getChallengeNumber(packet.request.contract) // web3.utils.randomHex(32)
	packet.start = new Date().getTime()
	packet.finish = null
	let res = await dbo.collection('shares').insertOne(packet)
    response.json(packet)
}))

// submit a solved share
// curl -d '{"origin":"0xaddress","challengeNumber":"0xchallengeNumber","nonce":"0xdeadbeef","contract": "0xcontract"}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/submit
app.post('/share/submit', asyncMiddleware( async (request, response, next) => {
  	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	// let docs = await dbo.collection('shares').find(ObjectId(packet.request.uid)).toArray()
	let p = await dbo.collection('shares').findOne({origin: request.body.origin, contract: request.body.contract, finish:{$eq: null}})
	if( !p ) {
		throw 'Could not find share with challengeNumber:' + packet.request.challengeNumber
	}

	// validate the share
	if(!util.validate(p.challengeNumber, pRequest.origin, pRequest.nonce, p.difficulty)) {
		throw 'Invalid nonce submitted'
	}

	p.status = VALID_STATUS
	p.finish = new Date().getTime()
	var dif = p.finish - p.start
	var seconds = Math.round( dif / 1000 )
	p.seconds = seconds > 0 ? seconds : 1
	p.hashrate = util.estimatedShareHashrate(p.difficulty, p.seconds)
	// await dbo.collection('shares').replaceOne({ '_id': ObjectId(packet.request.uid) }, p)
	await dbo.collection('shares').replaceOne({challengeNumber: packet.request.challengeNumber}, p)
	util.pruneSingle(dbo, pRequest.origin)
	response.json(p)
})) 

// Get the hashrate share for an account
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/shares/0xaddress
app.get('/shares/:account', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('shares').find({ origin: request.params.account }).toArray()
    response.json(res)
}))

// Get the hashrate share for an account
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/hashrate/0xaddress
app.get('/hashrate/:account', asyncMiddleware( async (request, response, next) => {
	var account = request.params.account
    let hashrateResponse = await util.accountHashrate( dbo, account )
    console.log(hashrateResponse)
	response.json(hashrateResponse)
}))

// Get the hashrate for the entire pool
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/pool/hashrate
app.get('/pool/hashrate', asyncMiddleware( async (request, response, next) => {
    const validTimeAgo = Date.now() - process.env.VALID_MILLISECONDS_WINDOW
	
	let docs = await dbo.collection('shares').aggregate(
	   [
	      {
	   		$match: {
	   		   'finish': { $gt: validTimeAgo }
     		} 
     	  },
	      {
	        $group : {
	           _id : {origin: "$origin"},
	           averageHashrate: { $avg: "$hashrate" }
	        }
	      }
	   ]
	).toArray()
	var globalHashrate = docs.reduce(function (accumulator, record) {
	  return accumulator + record.averageHashrate;
	}, 0)
	var hashrateResponse = {}
	hashrateResponse.globalHashrate = globalHashrate
	response.json(hashrateResponse)
}))

// list all of the pool's shares
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/pool/shares
app.get('/pool/shares', asyncMiddleware( async (request, response, next) => {
	response.json( await util.poolShares(dbo) )
}))

// admin functions
admin.get('/', asyncMiddleware( (request, response, next) => {
	response.json('hello admin')
}))

// prune the db
admin.get('/prune', asyncMiddleware( async (request, response, next) => {
	util.prune(dbo)
	response.json('done')
}))

// admin payout single
admin.get('/payout/:account', asyncMiddleware( async (request, response, next) => {
	util.processPayoutSingle(dbo, this.poolAccount, mineable, request.params.account)
    response.json('done')
}))
