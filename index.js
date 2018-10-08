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
const fetch = require('node-fetch')
const FormData = require('form-data')
const web3utils = require('web3-utils')
const fs = require('fs')
const mongodb = require('mongodb')
const ObjectId = require('mongodb').ObjectId
const Web3 = require('web3')
var web3 = new Web3()

const vault = require('./lib/vault')
const mineable = require('./lib/mineable-interface')

const SETTINGS = JSON.parse(fs.readFileSync('settings.json'))
const MINIMUM_SHARES_FOR_HASHRATE = SETTINGS.MINIMUM_SHARES_FOR_HASHRATE
const PORT = SETTINGS.PORT
const POOL_FEE_PCT = SETTINGS.POOL_FEE_PCT
const AUTOPRUNE_INTERVAL_MINUTES = SETTINGS.AUTOPRUNE_INTERVAL_MINUTES
const SHARE_LIMIT = SETTINGS.SHARE_LIMIT
const INVALID_STATUS = 'INVALID'
const VALID_STATUS = 'VALID'

// const ETHEREUM_PROVIDER_URL = 'https://rinkeby.infura.io/gmXEVo5luMPUGPqg6mhy'
const ETHEREUM_PROVIDER_URL = 'https://sokol.poa.network'

// const VALID_MILLISECONDS_WINDOW = 1000 * 60 * 60

const VALID_MILLISECONDS_WINDOW = 1000 * 60 * 60

console.log(SETTINGS.TITLE + ' version ' + SETTINGS.VERSION)

// prod mode
// const MAX_TARGET = web3utils.toBN( 2 ).pow( web3utils.toBN( 234 ) )
// 65536

// test mode
const MAX_TARGET = web3utils.toBN( 2 ).pow( web3utils.toBN( 244 ) )
// end test mode

const DEFAULT_SHARE_DIFFICULTY = SETTINGS.DEFAULT_SHARE_DIFFICULTY

var app = express()

var MongoClient = mongodb.MongoClient;

var dbo

var poolAccount

// start up the app
app.listen(PORT, async() => {
	console.log(SETTINGS.TITLE + ' version ' + SETTINGS.VERSION)
    // force login/setup
    title()
    
    // initialize objects
    web3.setProvider(ETHEREUM_PROVIDER_URL)
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
	  dbo = db.db("lodgepool")
	  // prune out older records
	  prune()
	  setInterval( prune, AUTOPRUNE_INTERVAL_MINUTES * 1000 * 60)
	})

	

})

/*
var privateKey = fs.readFileSync( 'privatekey.pem' )
var certificate = fs.readFileSync( 'certificate.pem' )

https.createServer({
    key: privateKey,
    cert: certificate
}, app).listen(port)
*/

app.use(express.json())
app.set('json spaces', 2)

// default error handler
/*
process.on('uncaughtException', function (err) {
  console.error(err)
})
*/

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
  response.json(SETTINGS.TITLE + ' version ' + SETTINGS.VERSION)
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
// curl -d '{"nonce": "0xnonce", "origin": "0xaddress", "signature": "0xsignature"}' -H "Content-Type: application/json" http://127.0.0.1:3000/mint
app.post('/mint', asyncMiddleware( async (request, response, next) => {
	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
    // attach additional metadata to the packet
    packet.origin = pRequest.origin
    packet.timestamp = new Date()

    packet.delegate = this.poolAccount.address
    // packet.status = 'SUCCESS'
    packet.txnId = ( await mineable.submit( this.poolAccount, pRequest.nonce, pRequest.origin, pRequest.signature) ).transactionHash
    packet.hashrate = await accountHashrate(pRequest.origin)
    packet.ipfsPin = ( await ipfsPin(packet) ).Hash
	let res = await dbo.collection('transactions').insertOne(packet)

	let payouts = await snapPayout(packet.txnId)
	await dbo.collection('payouts').insertMany(payouts)
	response.json(packet)
}))

app.get('/payouts', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({}).toArray()
    response.json(res)
}))

app.get('/payouts/:account', asyncMiddleware( async (request, response, next) => {
	let res = await dbo.collection('payouts').find({ account: request.params.account }).toArray()
    response.json(res)
}))

app.get('/snapPayout', asyncMiddleware( async (request, response, next) => {
	let payouts = await snapPayout('0xdeadbeef')
	response.json( payouts )
}))

async function snapPayout (txnId) {
	let rwd = await mineable.getReward(web3)
	let reward = rwd - (rwd * POOL_FEE_PCT / 100 )
	let docs = await poolShares()
	let payouts = []
	docs.forEach((doc) => {
		payout = reward * ( doc.percentShare / 100 )
		payouts.push({ payout: payout, account: doc._id.origin, mintTxn: txnId })
	})
	return payouts
}

// request a share to solve
// curl -d '{"origin":"0xaddress"}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/request
app.post('/share/request', asyncMiddleware( async (request, response, next) => {
	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	packet.difficulty = DEFAULT_SHARE_DIFFICULTY
	packet.challengeNumber = web3utils.randomHex(32)
	packet.start = new Date().getTime()
	packet.finish = null
	let res = await dbo.collection('shares').insertOne(packet)
    response.json(packet)
}))

// submit a solved share
// curl -d '{"origin":"0xaddress","uid":"vpOWChMmQrEbNx5y","nonce":"0xdeadbeef"}' -H "Content-Type: application/json" http://127.0.0.1:3000/share/submit
app.post('/share/submit', asyncMiddleware( async (request, response, next) => {
  	var pRequest = request.body
	var packet = {}
	packet.request = pRequest
	packet.origin = pRequest.origin
	let docs = await dbo.collection('shares').find(ObjectId(packet.request.uid)).toArray()
	if( docs.length < 1 ) { throw 'Could not find share with _id:' + packet.request.uid}
	let p = docs[0]
	// validate the share
	if(!validate(p.challengeNumber, pRequest.origin, pRequest.nonce, p.difficulty)) {
		throw 'error: Invalid nonce submitted'
	}
	if(p.finish !== null) {
		throw 'error: Share has already been submitted'
	}
	p.status = VALID_STATUS
	p.finish = new Date().getTime()
	var dif = p.finish - p.start
	var seconds = Math.round( dif / 1000 )
	p.seconds = seconds > 0 ? seconds : 1
	p.hashrate = estimatedShareHashrate(p.difficulty, p.seconds)
	await dbo.collection('shares').replaceOne({ '_id': ObjectId(packet.request.uid) }, p)

	pruneSingle(pRequest.origin)

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
    let hashrateResponse = await accountHashrate( account )
    console.log(hashrateResponse)
	response.json(hashrateResponse)
}))

async function accountHashrate (account) {
	const validTimeAgo = Date.now() - VALID_MILLISECONDS_WINDOW
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
	var accountHashRate = docs.filter( r => r._id.origin === account )[0].averageHashrate
	var hashrateResponse = {}
	hashrateResponse.globalHashrate = globalHashrate
	hashrateResponse.accountHashRate = accountHashRate
	hashrateResponse.percentShare = accountHashRate / globalHashrate * 100
	return hashrateResponse
}

// Get the hashrate for the entire pool
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/pool/hashrate
app.get('/pool/hashrate', asyncMiddleware( async (request, response, next) => {
	var account = request.params.account
    const validTimeAgo = Date.now() - VALID_MILLISECONDS_WINDOW
	
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

// prune the db
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/prune
app.get('/prune', function (request, response) {
	prune()
	response.json({'complete': true})
})

// prune the db
// curl -H "Content-Type: application/json" http://127.0.0.1:3000/pool/shares
app.get('/pool/shares', asyncMiddleware( async (request, response, next) => {
	response.json( await poolShares() )
}))

async function poolShares() {
	const validTimeAgo = Date.now() - VALID_MILLISECONDS_WINDOW
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
	           averageHashrate: { $avg: "$hashrate" },
	           count: { $sum: 1 }
	        }
	      }
	   ]
	).toArray()
	
	var globalHashrate = docs.reduce(function (accumulator, record) {
	  return accumulator + record.averageHashrate
	}, 0)

	docs.forEach( (doc) => {
  		doc.globalHashrate = globalHashrate
  		doc.percentShare = doc.averageHashrate / doc.globalHashrate * 100
	})
	return docs
}

// validate the nonce
function validate(challenge, publicKey, nonce, difficulty) {
	var digest = web3utils.soliditySha3( challenge, publicKey, nonce )
    var digestBigNumber = web3utils.toBN(digest)
    var target = targetFromDifficulty(difficulty)
    if( digestBigNumber.lt(target) ) {
    	return true
    }
    return false
}

// calculate the mining target from difficulty
function targetFromDifficulty(difficulty) {
  	return MAX_TARGET.div( web3utils.toBN( difficulty) )
}

// pin content to IPFS for record keeping
async function ipfsPin (payload, cb) {
	let form = new FormData()
	form.append('file', JSON.stringify(payload, null, 2) )
	let response = await fetch('https://ipfs.infura.io:5001/api/v0/add?pin=true', { method: 'POST', body: form })
	return await response.json()
}

//TimeToSolveBlock (seconds) = difficulty * 2^22 / hashrate (hashes per second)
//hashrate = (difficulty * 2^22) / timeToSolveABlock seconds)
function estimatedShareHashrate(difficulty, timeToFindSeconds) {
  if(timeToFindSeconds && timeToFindSeconds > 0) {
    return web3utils.toBN(difficulty)
    		.mul( web3utils.toBN(2).pow(  web3utils.toBN(22) ))
    		.div( web3utils.toBN( timeToFindSeconds ))
    		.toNumber()
  }
  return 0
}

// autoprune share records older than VALID_MILLISECONDS_WINDOW
async function prune() {
	// prune out old shares
	const validTimeAgo = Date.now() - VALID_MILLISECONDS_WINDOW
	dbo.collection('shares').deleteMany({ finish: { $lt: validTimeAgo } })    
	console.log('-- autoprune complete --')
}

// autoprune completed shares leaving only top 'SHARE_LIMIT'
async function pruneSingle(origin) {
	// await prune()
	let top = await dbo.collection('shares').find({ origin: origin, finish: { $ne:null } })
											.sort({finish:-1})
											.limit(SHARE_LIMIT)
											.toArray()

    let topIds = top.map( (doc) => ObjectId(doc._id) )
	dbo.collection('shares').deleteMany({ origin: origin, finish: { '$ne': null }, '_id': { '$nin': topIds} })
}
