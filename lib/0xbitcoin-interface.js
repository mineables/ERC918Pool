const Web3 = require('web3')
var web3 = new Web3()
const Tx = require('ethereumjs-tx')

const bitcoinJson = require('../abi/0xbitcoin.json')
const BITCOIN_ADDRESS = '0xb6ed7644c69416d67b522e20bc294a9a9b405b31'

web3.setProvider('https://mainnet.infura.io/WugAgm82bU9X5Oh2qltc')
MAX_TARGET = web3.utils.toBN( 2 ).pow( web3.utils.toBN( 234 ) )

module.exports = {
	async init() {
		this.bitcoin = new web3.eth.Contract(bitcoinJson.abi, BITCOIN_ADDRESS)
	},

	async validate (publicKey, nonce) {
		let challenge = await this.bitcoin.methods.getChallengeNumber().call()
		let difficulty = await this.bitcoin.methods.getMiningDifficulty().call()
		return this.validateNonce(challenge, publicKey, nonce, difficulty)
	},
	
	// validate the nonce
	validateNonce(challenge, publicKey, nonce, difficulty) {
		var digest = web3.utils.soliditySha3( challenge, publicKey, nonce )
	    var digestBigNumber = web3.utils.toBN(digest)
	    var target = this.targetFromDifficulty(difficulty)
	    if( digestBigNumber.lt(target) ) {
	    	return true
	    }
	    return false
	},

	targetFromDifficulty(difficulty) {
	  	return MAX_TARGET.div( web3.utils.toBN( difficulty) )
	}
	

}