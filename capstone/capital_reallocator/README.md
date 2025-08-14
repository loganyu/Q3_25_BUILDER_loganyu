# Capital Reallocator - Automated DeFi Strategy Protocol

*Built on Solana with Anchor, Pyth, Meteora, and Kamino*

A Solana program that automatically rebalances capital between liquidity provision (Meteora DLMM) and lending (Kamino) based on real-time price data from Pyth Network.

## 🛠️ Installation

## 🌐 Environment Setup

### Local Development
```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json
solana config set --url localhost
```

### Devnet Testing
```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/devnet.json
solana config set --url devnet
```

## 📚 Usage Guide

### Local Testing Workflow

**1. Start Local Validator**
```bash
# Terminal 1 - Keep running
yarn validator
```

**2. Deploy Program**
```bash
# Terminal 2
yarn build
yarn deploy
```

**3. Setup Environment**
```bash
yarn setup           # Create accounts
yarn fund           # Add tokens
yarn init-protocol   # Initialize protocol (0.5% fee)
yarn init-user       # Initialize user account
```

**4. Create and Fund Position**
```bash
yarn create-position    # Create position with $100-$200 range
yarn deposit 1 0.1      # Deposit 100 Token A, 1 Token B
yarn balances          # Check all balances
```

**5. Test Operations**
```bash
yarn withdraw 25       # Withdraw 25%
yarn balances         # Check updated balances
yarn withdraw 100     # Withdraw remaining
yarn close-position   # Close empty position
```

**6. Cleanup**
```bash
yarn close-accounts:confirm  # Recover SOL from accounts
yarn clean                   # Clean state and build files
```

### Devnet Testing

**1. Deploy to Devnet**
```bash
yarn deploy:devnet
```

**2. Setup Devnet Environment**
```bash
yarn setup

yarn fund-devnet
```
**3. Test with Real Prices**
```bash
yarn pyth-devnet price         # Get current SOL/USD price
yarn pyth-devnet check         # Check position status
yarn pyth-devnet rebalance     # Execute rebalancing
yarn pyth-devnet monitor 60    # Monitor for 60 seconds
```

## 📋 Available Commands

### Core Operations
| Command | Description |
|---------|-------------|
| `yarn build` | Build the program |
| `yarn deploy` | Deploy to local validator |
| `yarn deploy:devnet` | Deploy to devnet |
| `yarn test` | Run test suite |

### Environment Setup
| Command | Description |
|---------|-------------|
| `yarn validator` | Start local validator |
| `yarn setup` | Create test environment |
| `yarn init-protocol` | Initialize protocol |
| `yarn init-user` | Initialize user account |

### Position Management
| Command | Description |
|---------|-------------|
| `yarn create-position` | Create new position |
| `yarn deposit <A> <B>` | Deposit tokens (e.g., `yarn deposit 100 1`) |
| `yarn withdraw <percent>` | Withdraw percentage (e.g., `yarn withdraw 25`) |
| `yarn close-position` | Close empty position |

### Monitoring
| Command | Description |
|---------|-------------|
| `yarn balances` | Check all balances |
| `yarn monitor` | Position dashboard |

### Pyth Integration (Devnet)
| Command | Description |
|---------|-------------|
| `yarn pyth-devnet price` | Get current SOL/USD price |
| `yarn pyth-devnet check` | Check position status |
| `yarn pyth-devnet rebalance` | Execute rebalancing |
| `yarn pyth-devnet monitor [seconds]` | Auto-monitor position |

### Cleanup
| Command | Description |
|---------|-------------|
| `yarn close-accounts` | Preview account cleanup |
| `yarn close-accounts:confirm` | Execute cleanup |
| `yarn clean` | Clean state and build files |

## 🏗️ Architecture

### Core Components
- **ProtocolAuthority**: Global protocol configuration
- **UserMainAccount**: User's position registry  
- **Position**: Individual strategy position
- **Token Vaults**: Associated token accounts for idle funds

### Rebalancing Logic
1. **Price In Range** → Move to Meteora LP
2. **Price Out of Range** → Move to Kamino Lending
3. **Idle Funds** → Deploy based on current price

### External Integrations
- **Meteora DLMM**: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`
- **Kamino Lending**: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- **Jupiter Aggregator**: `JUPyTerVGraWPqKUN5g8STQTQbZvCEPfbZFpRFGHHHH`
- **Pyth Network**: Real-time price feeds with confidence intervals

## 🧪 Testing

### Local Testing
```bash
yarn build
yarn deploy
yarn test
```

### Devnet Testing
```bash
yarn deploy:devnet
yarn setup
yarn pyth-devnet check
```
