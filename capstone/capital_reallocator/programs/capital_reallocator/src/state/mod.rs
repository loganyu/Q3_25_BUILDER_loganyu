use anchor_lang::prelude::*;

#[account]
pub struct SharedVaultAccount {
    pub authority: Pubkey,
    pub total_deposits: u64,
    pub total_shares: u64,
    pub protocol_fee_basis_points: u16,
    pub fee_recipient: Pubkey,
    pub bump: u8,
    pub usdc_mint: Pubkey,
    pub sol_mint: Pubkey,
    pub usdc_vault: Pubkey,
    pub sol_vault: Pubkey,
    pub fee_collection_account: Pubkey,
    pub temporary_swap_account: Pubkey,
}

#[account]
pub struct UserPositionAccount {
    pub owner: Pubkey,
    pub shares: u64,
    pub lp_range_min: u64,
    pub lp_range_max: u64,
    pub lp_allocation: u8,
    pub lending_allocation: u8,
    pub pause_flag: bool,
    pub last_rebalance: i64,
    pub bump: u8,
}

#[account]
pub struct LpPositionAccount {
    pub user_position: Pubkey,
    pub position_id: u64,
    pub liquidity: u128,
    pub token_0_amount: u64,
    pub token_1_amount: u64,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub fee_growth_inside: u128,
    pub bump: u8,
}

#[account]
pub struct LendingPositionAccount {
    pub user_position: Pubkey,
    pub lending_shares: u64,
    pub deposited_amount: u64,
    pub last_update: i64,
    pub protocol: [u8; 32],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PositionMetadata {
    pub position_id: u64,
    pub is_active: bool,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority,
    
    #[msg("Invalid fee basis points")]
    InvalidFeeBasisPoints,
    
    #[msg("Position out of range")]
    PositionOutOfRange,
    
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    
    #[msg("Invalid price range")]
    InvalidPriceRange,
    
    #[msg("Paused")]
    Paused,
    
    #[msg("Rebalance too soon")]
    RebalanceTooSoon,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Invalid allocation")]
    InvalidAllocation,
}

pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_POSITION_SEED: &[u8] = b"position";
pub const LP_POSITION_SEED: &[u8] = b"lp";
pub const LENDING_POSITION_SEED: &[u8] = b"lending";
pub const FEE_COLLECTION_SEED: &[u8] = b"fee_collection";
pub const TEMP_SWAP_SEED: &[u8] = b"temp_swap";

pub const MAX_FEE_BASIS_POINTS: u16 = 10000; // 100%
pub const MIN_REBALANCE_INTERVAL: i64 = 3600; // 1 hour
