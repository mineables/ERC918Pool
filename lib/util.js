const mongodb = require('mongodb')
const ObjectId = mongodb.ObjectId
const FormData = require('form-data')
const fetch = require('node-fetch')
require('dotenv').config()

const mineableJson = require('../abi/BoostableMineableToken.json')
const vrigJson = require('../abi/VirtualMiningBoard.json')
const addr = require('./addr.js')

module.exports = {
	init(web3) {
		this.web3 = web3
		// this.MAX_TARGET = process.env.TEST_MODE ? this.web3.utils.toBN( 2 ).pow( this.web3.utils.toBN( 244 ) ) : this.web3.utils.toBN( 2 ).pow( this.web3.utils.toBN( 234 ) )
		if(process.env.TEST_MODE === true) {
			console.log('-- Using test MAX_TARGET --')
			this.MAX_TARGET = this.web3.utils.toBN( 2 ).pow( this.web3.utils.toBN( 244 ) )
		} else {
			this.MAX_TARGET = this.web3.utils.toBN( 2 ).pow( this.web3.utils.toBN( 234 ) )
		}
		console.log('MAX_TARGET: ' + this.MAX_TARGET)
	},

	async getVirtualDifficulty(origin, mineableAddress)
	{
		let mineable = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
		let vrig = new this.web3.eth.Contract(vrigJson.abi, addr.VRIG)

		let adjInterval = await mineable.methods.adjustmentInterval().call();
		console.log('adjInterval: ', adjInterval)
		let vrigId = await mineable.methods.getInstalledBoosterFor(origin).call()
		let stats = await vrig.methods.mergedStats(vrigId).call({from: origin})
		console.log(stats)
		console.log(stats[1][4])
		let vhash = stats[1][4]

		// diff = adjInt * vHash / 2^22
		let diff = this.web3.utils.toBN(adjInterval)
								  .mul( this.web3.utils.toBN(vhash) )
								  .div( this.web3.utils.toBN(2).pow(  this.web3.utils.toBN(22) ) ).toNumber()
		console.log('Diff = ' + diff)
		return diff
	},

	async shareCount(dbo, challengeNumber) {
		let docs = await dbo.collection('sharecount').find({'challengeNumber': challengeNumber}).toArray()

		var totalBlockshares = docs.reduce(function (accumulator, doc) {
		  return accumulator + doc.count
		}, 0)

		// check for virtual diff
		let vRes = docs.filter( (doc) => { doc.vcount > 0 } )
		if( vRes.length > 0) {
			// add the most recent vDiff
			console.log('+++ Adding Virtual Diff: ' + vRes[vRes.length])
			totalBlockshares += vRes[vRes.length]
		}

		docs.forEach( (doc) => {
	  		doc.totalBlockshares = totalBlockshares
	  		doc.percentShare = doc.count / doc.totalBlockshares * 100
		})

		console.log(docs)

		return docs
	},

	async processPayoutRecord(reward, doc, mineable, contractAddress) {
		payout = reward * ( doc.percentShare / 100 )
		payoutLong = await mineable.longForm(contractAddress, payout)
		payouts.push({ payout: payout, payoutLong: payoutLong, account: doc._id.origin, mintTxn: txnId, contract: contractAddress })
	},

	async snapPayout (dbo, txnId, contractAddress, mineable, challengeNumber) {
		let rwd = await mineable.getReward(contractAddress)
		let reward = rwd - (rwd * process.env.POOL_FEE_PCT / 100 )
		let docs = await this.shareCount(dbo, challengeNumber)
		let payouts = []
		docs.forEach((doc) => {
			processPayoutRecord(reward, doc, mineable, contractAddress)
		})
		return payouts
	},

	// validate the nonce
	validate(challenge, publicKey, nonce, difficulty) {
		var digest = this.web3.utils.soliditySha3( challenge, publicKey, nonce )
	    var digestBigNumber = this.web3.utils.toBN(digest)
	    var target = this.targetFromDifficulty(difficulty)
	    if( digestBigNumber.lt(target) ) {
	    	return true
	    }
	    return false
	},

	async validateBlock(mineable, contractAddress, publicKey, nonce) {
		var difficulty = await mineable.getDifficulty(contractAddress, publicKey)
		var challenge = await mineable.getChallengeNumber(contractAddress)
		return await this.validate(challenge, publicKey, nonce, difficulty)
	},

	// calculate the mining target from difficulty
	targetFromDifficulty(difficulty) {
	  	return this.MAX_TARGET.div( this.web3.utils.toBN( difficulty) )
	},

	// pin content to IPFS for record keeping
	async ipfsPin (payload, cb) {
		let form = new FormData()
		form.append('file', JSON.stringify(payload, null, 2) )
		let response = await fetch('https://ipfs.infura.io:5001/api/v0/add?pin=true', { method: 'POST', body: form })
		return await response.json()
	},

	//TimeToSolveBlock (seconds) = difficulty * 2^22 / hashrate (hashes per second)
	//hashrate = (difficulty * 2^22) / timeToSolveABlock seconds)
	estimatedShareHashrate(difficulty, timeToFindSeconds) {
	  if(timeToFindSeconds && timeToFindSeconds > 0) {
	    return this.web3.utils.toBN(difficulty)
	    		.mul( this.web3.utils.toBN(2).pow(  this.web3.utils.toBN(22) ))
	    		.div( this.web3.utils.toBN( timeToFindSeconds ))
	    		.toNumber()
	  }
	  return 0
	},

	// autoprune share records older than VALID_MINUTES_WINDOW * 60 * 1000
	async prune(dbo) {
		// prune out old shares
		const validTimeAgo = Date.now() - process.env.VALID_MINUTES_WINDOW * 60 * 1000
		dbo.collection('shares').deleteMany({ start: { $lt: validTimeAgo }, finish:{ $eq: null } })
		console.log('-- autoprune complete --')
	},

	async processPayouts(dbo, account, mineable) {
		let res = await dbo.collection('payouts').find({ payoutTxn: { $exists: false }, payout: { $gte: process.env.MINIMUM_PAYOUT_TOKENS } }).toArray()
		for(var i = 0; i < res.length; i++) {
			var e = res[i]
			e.payoutTxn = ( await mineable.transfer( account, e.account, e.payoutLong, e.contract ) ).transactionHash
			console.log('Processed payout: ' + e.payoutTxn, account, e.account, e.payoutLong, e.contract)
			await dbo.collection('payouts').replaceOne( { _id: e._id }, e)
		}
	},

	async processPayoutSingle(dbo, account, mineable, origin) {
		let res = await dbo.collection('payouts').find({ payoutTxn: { $exists: false }, payout: { $gte: process.env.MINIMUM_PAYOUT_TOKENS } }).toArray()
		for(var i = 0; i < res.length; i++) {
			var e = res[i]
			e.payoutTxn = ( await mineable.transfer( account, e.account, e.payoutLong, e.contract ) ).transactionHash
			console.log('Processed payout: ' + e.payoutTxn, account, e.account, e.payoutLong, e.contract)
			await dbo.collection('payouts').replaceOne( { _id: e._id }, e)
		}
	},

	config() {
		var config = {
			TITLE: process.env.TITLE,
			VERSION: process.env.VERSION,
			ETHEREUM_PROVIDER_URL: process.env.ETHEREUM_PROVIDER_URL,
			DEFAULT_MINEABLE_ADDRESS: process.env.DEFAULT_MINEABLE_ADDRESS,
			MINIMUM_SHARES_FOR_HASHRATE: process.env.MINIMUM_SHARES_FOR_HASHRATE,
			SHARE_LIMIT: process.env.SHARE_LIMIT,
			DEFAULT_SHARE_DIFFICULTY: process.env.DEFAULT_SHARE_DIFFICULTY,
			AUTOPRUNE_INTERVAL_MINUTES: process.env.AUTOPRUNE_INTERVAL_MINUTES,
			POOL_FEE_PCT: process.env.POOL_FEE_PCT,
			PORT: process.env.PORT,
			VALID_MINUTES_WINDOW: process.env.VALID_MINUTES_WINDOW,
			TEST_MODE: process.env.TEST_MODE,
			PAYOUTS_CRON: process.env.PAYOUTS_CRON,
			MINIMUM_PAYOUT_TOKENS: process.env.MINIMUM_PAYOUT_TOKENS,
			MAX_TARGET: this.MAX_TARGET
		}
		var instructions = { 
			'/account/:account': 'Account Summary',
			'/tx/:account': 'List mint tranactions by account.',
			'/tx/:txnId': 'List a mint tranactions by Ethereum transaction id.',
			'/payouts': 'List all pool payouts.',
			'/payouts/:account': 'List an account\'s payouts.',
			'/blockshares/challenge/:challengeNumber': 'List shares by challengeNumber (token block).',
			'/blockshares/account/:account': 'List shares by account.',
			'/blockshares': 'List all of the the pool\'s blockshares.',
			'/archive': 'List the pool\'s IPFS archive.'
		}
		config.instructions = instructions
		return config
	}

}