const Tx = require('ethereumjs-tx')
const mineableJson = require('../abi/MineableToken.json')
var kue = require('kue')

let REDIS_ADDR = process.env.REDIS_ADDR || '127.0.0.1:6379';

var queue = kue.createQueue({
  redis: `redis://${REDIS_ADDR}`
});

const promisify = (inner) =>
     new Promise((resolve, reject) =>
        inner((err, res) => {
            if (err) { reject(err) }
            resolve(res);
        })
    );

queue.on('ready', () => {
  // If you need to
  console.info('Queue is ready!');
});

queue.on('error', (err) => {
  // handle connection errors here
  console.error('There was an error in the main queue!');
  console.error(err);
  console.error(err.stack);
});     

queue.process('txn', function(job, done) {
    //email(job.data.to, done);

//var tasks = new Queue(async function (input, cb) {

    console.log('entered queue')
    
    let web3 = job.data.web3
    let account = job.data.account
    let mineableAddress = job.data.mineableAddress
    let method = job.data.method

    let encodedABI = method.encodeABI()
    //let estimatedGas = method.estimateGas({from: account.address})
    var txCount = web3.eth.getTransactionCount(account.address) //this.seedTxnCount++

    var privateKey = Buffer.from(account.privateKey.substring(2,66), 'hex')
    var rawTx = {
      nonce: txCount,
      gasPrice: 0x3B9ACA00,
      gasLimit: 6000000,
      gas: 6000000,
      to: mineableAddress,
      value: 0,
      data: encodedABI
    }

    var tx = new Tx(rawTx)
    tx.sign(privateKey)

    var serializedTx = tx.serialize()
    console.log('Submitting transaction...')

    const parent = this
    //let result = await promisify(cb => { 
        web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
            .once('transactionHash', function(hash){
                console.log('transactionHash: ', hash)
            })
            .once('receipt', function(receipt){ 
                console.log('receipt: ', receipt)
            })
            .on('confirmation', async function(confNumber, receipt){
                console.log('confirmation: ', confNumber, receipt.transactionHash)
                done(null, receipt);
            })
            .on('error', function(error){
                console.log('error: ', error)
                done(error);
            }) 
     
    //}).catch(function(error){
   //     console.log(error)
    //})

   // done(result);
    //callback(result);
})

module.exports = {
	async init(web3, account) {
		this.web3 = web3
		this.seedTxnCount = await this.web3.eth.getTransactionCount(account.address)
		this.cache = new Map()
	},

	getMineableContract(address) {
		if( !this.cache.get(address) ) {
			this.cache.set(address, new this.web3.eth.Contract(mineableJson.abi, address))
		}
		return this.cache.get(address)
	},

	async transfer( account, to, amount, mineableAddress ) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	let decimals = await tokenContract.methods.decimals().call()
    	let realAmount = parseInt( amount * Math.pow(10, decimals) )
    	console.log(to, realAmount)
    	let method = tokenContract.methods.transfer(to, realAmount.toString())
    	return this.sendTransaction( account, mineableAddress, method)
    },

    delegatedMint( account, nonce, origin, signature, mineableAddress, cb ) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	let method = tokenContract.methods.delegatedMint(nonce, origin, signature)
    	return this.sendTransaction( account, mineableAddress, method)
    },

     
    sendTransaction(account, mineableAddress, method, cb) {
        //tasks.push({ web3: this.web3, account: account, mineableAddress: mineableAddress, method: method })

        let job = queue.create('txn', { web3: this.web3, account: account, mineableAddress: mineableAddress, method: method })
        job.save(cb)
    },
   
    
    /*
    async sendTransaction(account, mineableAddress, method) {
    	
    	let encodedABI = await method.encodeABI()
    	let estimatedGas = await method.estimateGas({from: account.address})
    	var txCount = this.seedTxnCount++

    	var privateKey = Buffer.from(account.privateKey.substring(2,66), 'hex')
    	var rawTx = {
		  nonce: txCount,
		  gasPrice: 0x3B9ACA00,
		  gasLimit: 6000000,
          gas: 6000000,
		  to: mineableAddress,
		  value: 0,
		  data: encodedABI
		}

		var tx = new Tx(rawTx)
		tx.sign(privateKey)

		var serializedTx = tx.serialize()
		console.log('Submitting transaction...')

        const parent = this
        return await promisify(cb => { 
            parent.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
                .once('transactionHash', function(hash){
                    console.log('transactionHash: ', hash)
                })
                .once('receipt', function(receipt){ 
                    console.log('receipt: ', receipt)
                })
                .on('confirmation', async function(confNumber, receipt){
                    console.log('confirmation: ', confNumber, receipt.transactionHash)
                    cb(null, receipt);
                })
                .on('error', function(error){
                    console.log('error: ', error)
                    cb(error);
                })      
        }).catch(function(error){
            console.log(error)
        })

    },
    */

    async longForm(mineableAddress, tokens) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	let decimals = await tokenContract.methods.decimals().call()
    	return tokens * Math.pow(10, decimals)
    },

    async decimals(mineableAddress) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	return await tokenContract.methods.decimals().call()
    },

    async getDifficulty(mineableAddress, origin) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	return await tokenContract.methods.getMiningDifficulty().call({from: origin})
    },

    async getChallengeNumber(mineableAddress) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	return await tokenContract.methods.getChallengeNumber().call()
    },

    async getReward(mineableAddress) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	let reward = await tokenContract.methods.getMiningReward().call()
    	let decimals = await tokenContract.methods.decimals().call()
    	return reward / Math.pow(10, decimals)
    }
}
