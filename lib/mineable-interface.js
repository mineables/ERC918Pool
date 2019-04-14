const Tx = require('ethereumjs-tx')
const mineableJson = require('../abi/MineableToken.json')

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
    	return await this.sendTransaction( account, mineableAddress, method)
    },

    promisify: (inner) => {
        new Promise((resolve, reject) =>
            inner((err, res) => {
                if (err) { reject(err) }
                resolve(res);
            })
        );
    },

    async sendTransaction(account, mineableAddress, method) {
    	
    	let encodedABI = await method.encodeABI()
    	let estimatedGas = await method.estimateGas({from: account.address})
    	var txCount = this.seedTxnCount++

    	var privateKey = Buffer.from(account.privateKey.substring(2,66), 'hex')
    	var rawTx = {
		  nonce: txCount,
		  gasPrice: 1000000000,
		  gasLimit: 4000000,
		  to: mineableAddress,
		  value: 0,
		  data: encodedABI
		}

		var tx = new Tx(rawTx)
		tx.sign(privateKey)

		var serializedTx = tx.serialize()
		console.log('Submitting transaction...')
		//let txId = await this.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
		/*
		.on('transactionHash', function(hash){
		  
		})
		.on('receipt', console.log)
		.on('confirmation', console.log)
		.on('error', console.log)
		*/
        const parent = this
        const txId = await this.promisify(cb => { 
            parent.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
            .once('transactionHash', function(hash){ 
            })
            .once('receipt', function(receipt){ 
            })
            .on('confirmation', async function(confNumber, receipt){
                cb(receipt);
            })
            .on('error', function(error){
                console.log('error')
                cb(error);
            })      
        })

		console.log('Transaction complete.')
		return txId

    },

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
