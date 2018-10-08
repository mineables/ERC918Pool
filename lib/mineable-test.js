const Web3 = require('web3')
var web3 = new Web3()
const mineable = require('./mineable-interface')
const vault = require('./vault')

async function init(){
	let account = await vault.account(web3)

	// from the user
	let nonce = '0x12b9bb91849ebeb0a365d735cf2cb63ad2c022a05621612ccd49719f428a44898c72152404fa295fd830956087ee0d970aea51283cdf864959b36d3454606b07'
	let origin = '0x43997Aa164DfE77F74c8D2d25607201E200f19a5'
	let signature = '0x74262bec00fc6c5f52990988c12dbfee0915e1f7b1725eee585fad226dbd51b92c749620b6edb398b575c14529766c236b062235f694d4b247c56beead6797101c'
	
	await mineable.submit(web3, account, nonce, origin, signature)
}

(async () => {

	init()

})();