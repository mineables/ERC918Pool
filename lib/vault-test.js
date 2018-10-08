const Web3 = require('web3')
var web3 = new Web3()
const vault = require('./vault')

async function init(){
	await vault.account(web3);
}

(async () => {

	init()

})();
