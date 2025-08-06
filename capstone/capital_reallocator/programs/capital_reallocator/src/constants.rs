pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const USER_SEED: &[u8] = b"user";
pub const POSITION_SEED: &[u8] = b"position";
pub const KEEPER_SEED: &[u8] = b"keeper";

// Oracle settings
pub const PRICE_MAX_AGE: u64 = 60; // 60 seconds
pub const PRICE_CONFIDENCE_MULTIPLIER: u64 = 2; // Max 2x confidence interval

// Protocol limits
pub const MAX_BATCH_SIZE: usize = 10;
pub const MAX_FEE_BPS: u16 = 1000; // 10% max fee
pub const MIN_POSITION_VALUE: u64 = 1_000_000; // $1 minimum position

// Rebalancing parameters
pub const REBALANCE_THRESHOLD_BPS: u16 = 100; // 1% price movement threshold
pub const MAX_SLIPPAGE_BPS: u16 = 200; // 2% max slippage

// LP parameters
pub const LP_FEE_TIER: u16 = 500; // 0.05% fee tier for Meteora
pub const MIN_TICK_SPACING: i32 = 10;
