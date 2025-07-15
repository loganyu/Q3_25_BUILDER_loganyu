use anchor_lang::preclude::*;

#[account]
#[derive(InitSpace)]
pub struct StakeConfig {
  pub points_per_stake: u32,
  pub amount_staked: u8,
  pub bump: u8,
}

