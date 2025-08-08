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
    pub bump: u8,
}
