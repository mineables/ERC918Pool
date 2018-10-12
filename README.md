# ERC918Pool
A minimalist, REST based pool service for ERC918 tokens on the Mineables network. The payout system follows a simple proportional distribution that tallies an account's total difficulty of submitted shares per token block.

# Configuration

Create an .env file with the following:
```
# MongoDB default setup
MONGO_INITDB_ROOT_USERNAME=mongouser
MONGO_INITDB_ROOT_PASSWORD=mongopass
MONGO_INITDB_DATABASE=mydb

# MongoDB pool setup
MONGO_USERNAME=<user>
MONGO_PASSWORD=<password>
MONGO_HOST=<host>
MONGO_PORT=<port>
MONGO_DB=<db-name>

# Pool account
PRIVATE_KEY=0x******

# Ethereum settings
ETHEREUM_PROVIDER_URL=https://sokol.poa.network

# Pool settings
TITLE=ERC918 Mining Pool Relayer (TEST MODE)
VERSION=1.0
MINIMUM_SHARES_FOR_HASHRATE=5
SHARE_LIMIT=10
DEFAULT_SHARE_DIFFICULTY=1
AUTOPRUNE_INTERVAL_MINUTES=10
POOL_FEE_PCT=6
PORT=3000
VALID_MINUTES_WINDOW=10
PAYOUTS_CRON=0 8 * * *
MINIMUM_PAYOUT_TOKENS=5
TEST_MODE=false

# Pool web admin, user is always 'admin'
ADMIN_PASSWORD=<password>
```

# Docker

To run the service in docker:
```
docker-compose up
```
