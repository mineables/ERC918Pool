require('dotenv').config()

module.exports = {
	async poolShares() {
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
	},

	async snapPayout (txnId) {
		let rwd = await mineable.getReward(web3)
		let reward = rwd - (rwd * process.env.POOL_FEE_PCT / 100 )
		let docs = await util.poolShares()
		let payouts = []
		docs.forEach((doc) => {
			payout = reward * ( doc.percentShare / 100 )
			payouts.push({ payout: payout, account: doc._id.origin, mintTxn: txnId })
		})
		return payouts
	},

	// validate the nonce
	validate(challenge, publicKey, nonce, difficulty) {
		var digest = web3utils.soliditySha3( challenge, publicKey, nonce )
	    var digestBigNumber = web3utils.toBN(digest)
	    var target = targetFromDifficulty(difficulty)
	    if( digestBigNumber.lt(target) ) {
	    	return true
	    }
	    return false
	},

	// calculate the mining target from difficulty
	targetFromDifficulty(difficulty) {
	  	return MAX_TARGET.div( web3utils.toBN( difficulty) )
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
	    return web3utils.toBN(difficulty)
	    		.mul( web3utils.toBN(2).pow(  web3utils.toBN(22) ))
	    		.div( web3utils.toBN( timeToFindSeconds ))
	    		.toNumber()
	  }
	  return 0
	},

	// autoprune share records older than VALID_MILLISECONDS_WINDOW
	async prune(dbo) {
		// prune out old shares
		const validTimeAgo = Date.now() - process.env.VALID_MILLISECONDS_WINDOW
		dbo.collection('shares').deleteMany({ finish: { $lt: validTimeAgo } })    
		console.log('-- autoprune complete --')
	},

	// autoprune completed shares leaving only top 'SHARE_LIMIT'
	async pruneSingle(origin) {
		// await prune()
		let top = await dbo.collection('shares').find({ origin: origin, finish: { $ne:null } })
												.sort({finish:-1})
												.limit(SHARE_LIMIT)
												.toArray()

	    let topIds = top.map( (doc) => ObjectId(doc._id) )
		dbo.collection('shares').deleteMany({ origin: origin, finish: { '$ne': null }, '_id': { '$nin': topIds} })
	},

	config(web3) {
		const MAX_TARGET = process.env.TEST_MODE ? web3.utils.toBN( 2 ).pow( web3.utils.toBN( 244 ) ) : web3.utils.toBN( 2 ).pow( web3.utils.toBN( 234 ) )
		var config = {
			TITLE: process.env.TITLE,
			VERSION: process.env.VERSION,
			ETHEREUM_PROVIDER_URL: process.env.ETHEREUM_PROVIDER_URL,
			MINIMUM_SHARES_FOR_HASHRATE: process.env.MINIMUM_SHARES_FOR_HASHRATE,
			SHARE_LIMIT: process.env.SHARE_LIMIT,
			DEFAULT_SHARE_DIFFICULTY: process.env.DEFAULT_SHARE_DIFFICULTY,
			AUTOPRUNE_INTERVAL_MINUTES: process.env.AUTOPRUNE_INTERVAL_MINUTES,
			POOL_FEE_PCT: process.env.POOL_FEE_PCT,
			PORT: process.env.PORT,
			VALID_MILLISECONDS_WINDOW: process.env.VALID_MILLISECONDS_WINDOW,
			TEST_MODE: process.env.TEST_MODE,
			MAX_TARGET: MAX_TARGET
		}
		return config
	}

}