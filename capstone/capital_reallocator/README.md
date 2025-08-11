# Capital Reallocator - Automated Lending/LP Rebalancing Protocol

This Solana program implements an automated capital allocation protocol that dynamically moves funds between liquidity provision (LP) positions and lending protocols based on price ranges.

## Architecture Overview

### Core Components

1. **Protocol Authority**: Global protocol state and configuration
2. **User Main Account**: Tracks user's positions and statistics
3. **Position**: Individual strategy position with LP range configuration
4. **Vault Accounts**: Associated token accounts that hold idle funds

### Key Features

- **Automated Rebalancing**: Moves capital between Meteora LP and Kamino lending based on price
- **Multi-Position Support**: Users can create multiple positions with different ranges
- **Fee System**: Protocol charges configurable fees on deposits/withdrawals
- **Position Management**: Pause/resume automation, partial withdrawals

## Getting Started

### Prerequisites

- Rust 1.75+
- Solana CLI 1.18+
- Anchor CLI 0.31.1
- Node.js 16+

### Installation

# Install dependencies
`npm install`

# Build the program
`anchor build`

# Run tests
`anchor test`


# 🧪 Capital Reallocator Testing Scripts

## 🔧 Environment Setup

### Environment Files

Set environment variables

#### Local Testing
```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json

solana config set --url localhost
solana airdrop 2
```

### Devnet Testing
```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/devnet.json

solana config set --url devnet
solana airdrop 2
```

Visit the Circle faucet as instructed in the setup output:
1. Go to: https://faucet.circle.com/
2. Enter your wallet address (shown in setup output)
3. Select "Solana Devnet"
4. Request USDC


### Solana CLI Configuration

## Local Testing

### Step 1: Start Local Validator
```bash
# Terminal 1 - Keep this running
yarn validator

# Or manually:
solana-test-validator --reset --quiet
```

### Step 2: Deploy Program
```bash
# Terminal 2
anchor deploy
```

## Interactive Testing

```bash
# Setup test environment (creates test tokens)
yarn setup

# Initialize protocol
yarn init-protocol

# Initialize user account
yarn init-user

# Create a position
yarn create-position

# Test deposits
yarn deposit 10 1  # 10 Token A, 1 Token B

# Check balances
yarn balances

# Test withdrawals
yarn withdraw 25     # Withdraw 25%
yarn withdraw 100    # Withdraw remaining

# Close position when empty
yarn close-position

# Clear state (user keypair, positions, pdas)
yarn clean
```

## Interactive Testing Workflow

### Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `yarn setup` | Create accounts and tokens | Sets up everything |
| `yarn init-protocol` | Initialize protocol | Sets fee structure |
| `yarn init-user` | Initialize user account | Creates user PDA |
| `yarn create-position` | Create trading position | Sets price range |
| `yarn deposit` | Deposit tokens | `yarn deposit 100 5` |
| `yarn withdraw` | Withdraw percentage | `yarn withdraw 25` |
| `yarn balances` | Check all balances | Shows complete state |
| `yarn close-position` | Close empty position | Cleans up accounts |


### State Persistence
- All account addresses saved to `scripts/state.json`
- Continue testing where you left off
- Clean slate: `yarn clean` then restart

### Command Line Monitoring

```bash
# Check account balances
yarn balances

# View SOL balance
solana balance

# View token accounts
spl-token accounts

# Check specific token balance
spl-token balance <TOKEN_MINT>

# View account details
solana account <ACCOUNT_ADDRESS>

# View transaction details
solana transaction <SIGNATURE>
```

### Real-time Logs
```bash
# View validator logs (local only)
solana logs

# View program logs
solana logs --url devnet | grep "<YOUR_PROGRAM_ID>"
```
