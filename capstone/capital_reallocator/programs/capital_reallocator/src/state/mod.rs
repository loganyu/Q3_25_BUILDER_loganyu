// state/mod.rs
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolAuthority {
    pub program_id: Pubkey,
    pub fee_recipient: Pubkey,
    pub protocol_fee_bps: u16,
    pub total_positions: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserMainAccount {
    pub owner: Pubkey,
    pub position_count: u64,
    pub total_positions_created: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub position_id: u64,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault_balance: u64,
    pub token_b_vault_balance: u64,
    pub token_a_in_lp: u64,
    pub token_b_in_lp: u64,
    pub token_a_in_lending: u64,
    pub token_b_in_lending: u64,
    pub lp_range_min: u64,
    pub lp_range_max: u64,
    pub pause_flag: bool,
    pub created_at: i64,
    pub last_rebalance_slot: u64,
    pub last_rebalance_price: u64,
    pub total_rebalances: u64,  
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct KeeperRegistry {
    pub authority: Pubkey,
    #[max_len(10)]
    pub keepers: Vec<Pubkey>,
    pub reward_percentage: u16,
    pub min_rebalance_value: u64,
    pub bump: u8,
}

// For storing oracle configuration
#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    pub protocol_authority: Pubkey,
    pub token_a_price_feed: Pubkey,     // Pyth price feed for token A
    pub token_b_price_feed: Pubkey,     // Pyth price feed for token B
    pub max_confidence_percentage: u16,  // Max acceptable confidence as % of price
    pub max_staleness_slots: u64,       // Max age of price in slots
    pub bump: u8,
}
