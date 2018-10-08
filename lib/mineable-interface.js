const web3Utils = require('web3-utils')
const Tx = require('ethereumjs-tx')
const mineableJson = require('../abi/MineableToken.json')

const contractAddress = '0xa0f0451e9896840d9a4ccee0478bdee6f7c88fdf'

module.exports = {
	init(web3) {
		this.web3 = web3
		this.tokenContract = new web3.eth.Contract(mineableJson.abi, contractAddress)
	},
    submit( account, nonce, origin, signature) {
    	// this.web3 = web3
    	// tokenContract = new web3.eth.Contract(mineableJson.abi, contractAddress)
    	return this.sendTransaction( account, nonce, origin, signature)
    },
    async sendTransaction( account, nonce, origin, signature) {
    	let method = this.tokenContract.methods.delegatedMint(nonce, origin, signature)
    	let encodedABI = await method.encodeABI()
    	let estimatedGas = await method.estimateGas()
    	var txCount = await this.web3.eth.getTransactionCount(account.address)
    	
    	var privateKey = Buffer.from(account.privateKey.substring(2,66), 'hex')
    	var rawTx = {
		  nonce: txCount,
		  gasPrice: 10000000000,
		  gasLimit: estimatedGas,
		  to: contractAddress,
		  value: 0,
		  data: encodedABI
		}

		var tx = new Tx(rawTx)
		tx.sign(privateKey)

		var serializedTx = tx.serialize()

		console.log("Submitting transaction")

		return await this.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
		/*
		.on('transactionHash', function(hash){
		  
		})
		.on('receipt', console.log)
		.on('confirmation', console.log)
		.on('error', console.log)
		*/

    },
    async getReward() {
    	this.tokenContract = new this.web3.eth.Contract(mineableJson.abi, contractAddress)
    	let reward = await this.tokenContract.methods.getMiningReward().call()
    	let decimals = await this.tokenContract.methods.decimals().call()
    	return reward / Math.pow(10, decimals)
    }
}
