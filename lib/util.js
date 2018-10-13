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
		let vrigId = await mineable.methods.getInstalledBoosterFor(origin).call()
		if(vrigId < 1) return 0
		let stats = await vrig.methods.mergedStats(vrigId).call({from: origin})
		let vhash = stats[1][4]
		if(!vhash) return 0

		// diff = adjInt * vHash / 2^22
		let diff = this.web3.utils.toBN(adjInterval)
								  .mul( this.web3.utils.toBN(vhash) )
								  .div( this.web3.utils.toBN(2).pow(  this.web3.utils.toBN(22) ) ).toNumber()
		return diff
	},

	async shareCount(dbo, challengeNumber) {
		let docs = await dbo.collection('sharecount').find({'challengeNumber': challengeNumber}).toArray()

		var totalBlockshares = docs.reduce( (accumulator, doc) => {
		  return accumulator + doc.count + doc.vcount
		}, 0)

		docs.forEach( (doc) => {
	  		doc.totalBlockshares = totalBlockshares
	  		doc.percentShare = (doc.count + doc.vcount) / doc.totalBlockshares * 100
		})

		return docs
	},

	async asyncForEach(array, callback) {
	  for (let index = 0; index < array.length; index++) {
	    await callback(array[index], index, array)
	  }
	},

	async snapPayout (dbo, txnId, contractAddress, mineable, challengeNumber) {
		let rwd = await mineable.getReward(contractAddress)
		let decimals = await mineable.decimals(contractAddress)
		let reward = rwd - (rwd * process.env.POOL_FEE_PCT / 100 )
		let docs = await this.shareCount(dbo, challengeNumber)
		let payouts = []
		for (let i = 0; i < docs.length; i++) {
			doc = docs[i]
			let payout = reward * ( doc.percentShare / 100 )
			let payoutLong = parseInt( payout * Math.pow(10, decimals) )
			payouts.push({ payout: payout, payoutLong: payoutLong, account: doc._id.origin, mintTxn: txnId, contract: contractAddress })
		}
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

	async processPayouts(dbo, poolaccount, mineable) {
		let res = await dbo.collection('payouts').aggregate(
		[		    
		    {
			  $group : {
			       _id : { account: '$account', contract: '$contract' },
			       payout: { $sum: '$payout' }
			  }
		  	}
		]).toArray()

		for (var i = 0; i < res.length; i++) {
			var e = res[i]
			let payoutTxn = ( await mineable.transfer( poolaccount, e._id.account, e.payout, e._id.contract ) ).transactionHash
			console.log('Processed payout: ' + payoutTxn, e._id.account, e.payout, e._id.contract)
			await dbo.collection('payouts').updateMany(
		      { account: e._id.account, contract: e._id.contract },
		      { $set: { 'payoutTxn' : payoutTxn } }
		    )
		}		
	},

	async processPayoutSingle(dbo, poolaccount, mineable, origin) {
		let res = await dbo.collection('payouts').aggregate(
		[
		    {
			  $match: {
				   account: { $eq: origin },
				   payoutTxn: { $exists: false }
			  } 
			},
		    {
			  $group : {
			       _id : { account: '$account', contract: '$contract' },
			       payout: { $sum: '$payout' }
			  }
		  	}
		]).toArray()

		for (var i = 0; i < res.length; i++) {
			var e = res[i]
			let payoutTxn = ( await mineable.transfer( poolaccount, e._id.account, e.payout, e._id.contract ) ).transactionHash
			console.log('Processed payout: ' + payoutTxn, e._id.account, e.payout, e._id.contract)
			await dbo.collection('payouts').updateMany(
		      { account: origin, contract: e._id.contract },
		      { $set: { 'payoutTxn' : payoutTxn } }
		    )
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
			MINIMUM_SHARE_DIFFICULTY: process.env.MINIMUM_SHARE_DIFFICULTY,
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