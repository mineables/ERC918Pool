# ERC918Pool
A minimalist, REST based pool software for ERC918 tokens.

# Configuration

Create an .env file with the following:
```
# MongoDB default setup
MONGO_INITDB_ROOT_USERNAME=mongouser
MONGO_INITDB_ROOT_PASSWORD=mongopass
MONGO_INITDB_DATABASE=mydb

# Account user
PRIVATE_KEY=0x******
```

#Docker

To run the service in docker:
```
docker-compose up
```
