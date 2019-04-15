const Tx = require('ethereumjs-tx')
const mineableJson = require('../abi/MineableToken.json')
var Queue = require('better-queue')


const promisify = (inner) =>
     new Promise((resolve, reject) =>
        inner((err, res) => {
            if (err) { reject(err) }
            resolve(res);
        })
    );

var tasks = new Queue(function (input, cb) {
    
    let web3 = input.web3
    let account = input.account
    let mineableAddress = input.mineableAddress
    let method = input.method

    let encodedABI = method.encodeABI()
    let estimatedGas = method.estimateGas({from: account.address})
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
                cb(null, receipt);
            })
            .on('error', function(error){
                console.log('error: ', error)
                cb(error);
            }) 
     
    //}).catch(function(error){
    //    console.log(error)
    //})
 
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
    	return await this.sendTransaction( account, mineableAddress, method)
    },

    async delegatedMint( account, nonce, origin, signature, mineableAddress ) {
    	let tokenContract = this.getMineableContract(mineableAddress)
    	let method = tokenContract.methods.delegatedMint(nonce, origin, signature)
    	return this.sendTransaction( account, mineableAddress, method)
    },

     
    sendTransaction(account, mineableAddress, method) {
        tasks.push({ web3: this.web3, account: account, mineableAddress: mineableAddress, method: method })
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
