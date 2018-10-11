const mongodb = require('mongodb')
const ObjectId = mongodb.ObjectId
const FormData = require('form-data')
const fetch = require('node-fetch')
require('dotenv').config()

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

	async blockShares(dbo, challengeNumber) {
		let docs = await dbo.collection('shares').aggregate(
		   [
		      {
		   		$match: {
		   		   'challengeNumber': { $eq: challengeNumber }
	     		} 
	     	  },
		      {
		        $group : {
		           _id : {origin: "$origin", challengeNumber: "$challengeNumber"},
		           blockshares: { $sum: "$difficulty" }
		        }
		      }
		   ]
		).toArray()

		var totalBlockshares = docs.reduce(function (accumulator, record) {
		  return accumulator + record.blockshares
		}, 0)

		docs.forEach( (doc) => {
	  		doc.totalBlockshares = totalBlockshares
	  		doc.percentShare = doc.blockshares / doc.totalBlockshares * 100
		})
		return docs
	},

	async shareCount(dbo, challengeNumber) {
		let docs = await dbo.collection('sharecount').find({'challengeNumber': challengeNumber}).toArray()

		var totalBlockshares = docs.reduce(function (accumulator, record) {
		  return accumulator + record.count
		}, 0)

		docs.forEach( (doc) => {
	  		doc.totalBlockshares = totalBlockshares
	  		doc.percentShare = doc.count / doc.totalBlockshares * 100
		})
		return docs
	},

	async snapPayout (dbo, txnId, contractAddress, mineable, challengeNumber) {
		let rwd = await mineable.getReward(contractAddress)
		let reward = rwd - (rwd * process.env.POOL_FEE_PCT / 100 )
		let docs = await this.shareCount(dbo, challengeNumber)
		let payouts = []
		docs.forEach((doc) => {
			payout = reward * ( doc.percentShare / 100 )
			payouts.push({ payout: payout, account: doc._id, mintTxn: txnId, contract: contractAddress })
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

	async accountHashrate (dbo, account) {
		const validTimeAgo = Date.now() - process.env.VALID_MINUTES_WINDOW * 60 * 1000
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
		var record = docs.filter( r => r._id.origin === account )
		var accountHashRate = record ? 0 : record[0].averageHashrate
		var hashrateResponse = {}
		hashrateResponse.globalHashrate = globalHashrate
		hashrateResponse.accountHashRate = accountHashRate
		hashrateResponse.percentShare = globalHashrate > 0 ? accountHashRate / globalHashrate * 100 : 0
		return hashrateResponse
	},

	async processPayouts(dbo, account, mineable) {
		let res = await dbo.collection('payouts').find({ payoutTxn: { $exists: false } }).toArray()
		for(var i = 0; i < res.length; i++) {
			var e = res[i]
			e.payoutTxn = ( await mineable.transfer( account, e.account, e.payout, e.contract ) ).transactionHash
			console.log('Processed payout: ' + e.payoutTxn)
			await dbo.collection('payouts').replaceOne( { _id: e._id }, e)
		}
	},

	async processPayoutSingle(dbo, account, mineable, origin) {
		let res = await dbo.collection('payouts').find({ payoutTxn: { $exists: false }, account: origin }).toArray()
		for(var i = 0; i < res.length; i++) {
			var e = res[i]
			e.payoutTxn = ( await mineable.transfer( account, e.account, e.payout, e.contract ) ).transactionHash
			console.log('Processed payout: ' + e.payoutTxn)
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
			MAX_TARGET: this.MAX_TARGET
		}
		var instructions = { 
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