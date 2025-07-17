use anchor_lang::prelude::*;
use anchor_lang::InitSpace;

#[account]
#[derive(InitSpace)]
pub struct Marketplace {
  pub admin: Pubkey,
  pub fee: u16, // basis points
  pub bump: u8,
  pub treasury_bump: u8,
  pub rewards_bump: u8,
  #[max_len(32)]
  pub name: String, // 4 (space for u32/i32) + 32 (length of string in bytes)
}