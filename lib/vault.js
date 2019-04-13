require('dotenv').config()

module.exports = {
	async init(web3){
		account =  await web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
		let mongouser = process.env.MONGO_USERNAME
		let pw = process.env.MONGO_PASSWORD
		let mongohost = process.env.MONGO_HOST
		let mongoport = process.env.MONGO_PORT
		let mongoDbName = process.env.MONGO_DB

		// let url = `mongodb://${mongouser}:${pw}@${mongohost}:${mongoport}/${mongoDbName}`
		let url = `mongodb://${mongohost}:${mongoport}/${mongoDbName}?authSource=admin`
		return { account, url }
	}
}
