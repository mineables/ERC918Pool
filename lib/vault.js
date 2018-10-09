//const LocalStorage = require('node-localstorage').LocalStorage
//const prompts = require('prompts')
//const mkdirp = require('mkdirp')
//const fs = require('fs')
//const bcrypt = require('bcrypt')
//const Cryptr = require('cryptr')

require('dotenv').config()

const KEYSTORE_PATH = './.0xPool/keystore.json'
var account = null

module.exports = {
	async init(web3){
		account =  await web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
		//let url = 'mongodb://mongo:27017'

		let mongouser = process.env.MONGO_USERNAME
		let pw = process.env.MONGO_PASSWORD
		let mongohost = process.env.MONGO_HOST
		let mongoport = process.env.MONGO_PORT
		let mongoDbName = process.env.MONGO_DB

		let url = `mongodb://${mongouser}:${pw}@${mongohost}:${mongoport}/${mongoDbName}`
		console.log(url)
		return { account, url }
	},
	async init2(web3){
		this.web3 = web3

		if ( !fs.existsSync(KEYSTORE_PATH) ) {
		    mkdirp('./.0xPool', function (err) {
			    if (err) console.error(err)
			})
		}
		store = require('persistent-localstore')( { filePath: KEYSTORE_PATH } )
		
   		const promptResult = await prompts({
		    type: 'text',
		    name: 'userPassword',
		    message: 'Please supply password',
		    style: 'password'
		})
		userPassword = promptResult.userPassword

		var hash = store.get('hash')
	    if (!hash) {
	    	hash = bcrypt.hashSync(userPassword, 10)
	    	store.set('hash', hash)
	    	r = await this.initialSetup(userPassword)
	    	let keystore = this.web3.eth.accounts.encrypt( r.account.privateKey, userPassword )
			store.set('account-keystore', keystore)
			let cryptr = new Cryptr(userPassword)
			store.set('mongo-url', cryptr.encrypt(r.mongoUrl))
	    }
    	var res = bcrypt.compareSync(userPassword, hash)
		if( res == false ){
		   console.log('Incorrect password, exiting')
		   return false
		}
		let keystore = store.get('account-keystore')
		account = this.web3.eth.accounts.decrypt(keystore, userPassword)
		let enc = store.get('mongo-url')
    	let c = new Cryptr(userPassword)
    	let url = c.decrypt(enc)
		return { account, url }
	},
    async initialSetup(userPassword) {
    	
		let questions = [
		    {
		        type: 'text',
		        name: 'mongouser',
		        message: 'MongoDb username',
		        validate: (value) => /^[a-zA-Z\s\-]+$/.test(value)
		    },
		    {
		        type: 'text',
		        name: 'mongopass',
		        message: 'MongoDb password',
		        style: 'password'
		    },
		    {
		        type: 'text',
		        name: 'mongohost',
		        message: 'MongoDb host'
		    },

		    {
		        type: 'number',
		        name: 'mongoport',
		        message: 'MongoDb port'
		    },
		    {
		        type: 'text',
		        name: 'mongoDbName',
		        message: 'MongoDb db name'
		    },
		    {
		        type: 'text',
		        name: 'createOrLoad',
		        message: 'create new (n) or import (i) Ethereum account',
		        validate: (value) => /^(n|i)$/.test(value)
		    }
		]

		let result = await prompts(questions)

		let pw = escape(result.mongopass)
		let mongoUrl = `mongodb://${result.mongouser}:${pw}@${result.mongohost}:${result.mongoport}/${result.mongoDbName}`
    	console.log(mongoUrl)

		var account
		if(result.createOrLoad == 'n'){
			account = this.web3.eth.accounts.create()
		} else {
			let r = prompts({
			    type: 'text',
			    name: 'privateKey',
			    message: 'Private Key', style: 'password'
			})
			account = this.web3.eth.accounts.privateKeyToAccount(r.privateKey)
		}
		return { account, mongoUrl }
    }
}
