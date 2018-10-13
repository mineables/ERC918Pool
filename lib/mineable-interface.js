const web3Utils = require('web3-utils')
const Tx = require('ethereumjs-tx')
const mineableJson = require('../abi/MineableToken.json')

module.exports = {
	init(web3, account) {
		this.web3 = web3
		this.seedTxnCount = await this.web3.eth.getTransactionCount(account.address)
	},

	async transfer( account, to, amount, mineableAddress ) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	let decimals = await tokenContract.methods.decimals().call()
    	let realAmount = amount * Math.pow(10, decimals)
    	console.log(to, realAmount, mineableAddress)
    	let method = tokenContract.methods.transfer(to, realAmount.toString())
    	return this.sendTransaction( account, mineableAddress, method)
    },

    delegatedMint( account, nonce, origin, signature, mineableAddress ) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	let method = tokenContract.methods.delegatedMint(nonce, origin, signature)
    	return this.sendTransaction( account, mineableAddress, method)
    },

    async sendTransaction(account, mineableAddress, method) {
    	
    	let encodedABI = await method.encodeABI()
    	let estimatedGas = await method.estimateGas({from: account.address})
    	var txCount = this.seedTxnCount++

    	var privateKey = Buffer.from(account.privateKey.substring(2,66), 'hex')
    	var rawTx = {
		  nonce: txCount,
		  gasPrice: 1000000000,
		  gasLimit: estimatedGas,
		  to: mineableAddress,
		  value: 0,
		  data: encodedABI
		}

		var tx = new Tx(rawTx)
		tx.sign(privateKey)

		var serializedTx = tx.serialize()
		console.log('Submitting transaction...')
		let txId = await this.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
		/*
		.on('transactionHash', function(hash){
		  
		})
		.on('receipt', console.log)
		.on('confirmation', console.log)
		.on('error', console.log)
		*/
		console.log('Transaction complete.')
		return txId

    },

    async longForm(mineableAddress, tokens) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	let decimals = await tokenContract.methods.decimals().call()
    	return tokens * Math.pow(10, decimals)
    },

    async decimals(mineableAddress) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	return await tokenContract.methods.decimals().call()
    },

    async getDifficulty(mineableAddress, origin) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	return await tokenContract.methods.getMiningDifficulty().call({from: origin})
    },

    async getChallengeNumber(mineableAddress) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	return await tokenContract.methods.getChallengeNumber().call()
    },

    async getReward(mineableAddress) {
    	let tokenContract = new this.web3.eth.Contract(mineableJson.abi, mineableAddress)
    	let reward = await tokenContract.methods.getMiningReward().call()
    	let decimals = await tokenContract.methods.decimals().call()
    	return reward / Math.pow(10, decimals)
    }
}
