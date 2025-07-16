use anchor_lang::prelude::*;
use anchor_spl::{
    metadata::{
        mpl_token_metadata::instructions::{
            ThawDelegatedAccountCpi, 
            ThawDelegatedAccountCpiAccounts
        }, 
        MasterEditionAccount, 
        Metadata
    }, 
    token::{
        revoke, 
        Mint, 
        Revoke, 
        Token, 
        TokenAccount
    }
};

use crate::{StakeAccount, StakeConfig, UserAccount, ErrorCode};

#[derive(Accounts)]
pub struct Unstake<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  pub mint: Account<'info, Mint>,

  #[account(
    mut,
    associated_token::mint = mint,
    associated_token::authority = user,

  )]
  pub user_mint_ata: Account<'info, TokenAccount>,

  #[account(
    seeds = [
      b"metadata",
      metadata_program.key().as_ref(),
      mint.key().as_ref(),
      b"edition",
      bump,
    ],
    seeds::program = metadata_program.key(),
    bump,
  )]
  pub edition: Account<'info, MetadataAccount>,

  #[account(
    mut,
    seeds = [b"user", user.key().as_ref()],
    bump = user_account.bump,
  )]
  pub user_account: Account<'info, UserAccount>,

  #[account(
    init,
    payer = user,
    space = 8 + UserAccount::INIT_SPACE,
    seeds = [b"stake", mint.key().as_ref(), config.key().as_ref()],
    bump,
  )]
  pub stake_account: Account<'info, UserAccount>,

  pub system_program: Program<'info, System>,

  pub token_program: Program<'info, Token>,

  pub metadata_program: Program<'info, Metadata>,
}

impl<'info> Unstake<'info> {
  pub fn unstake(&mut self) -> Result<()> {
    let time_elapsed = ((Clock::get()?.unix_timestamp - self.stake_account.staked_at) / 86400) as u32;
    require!(time_elapsed >= self.config.freeze_period, StakeError::TimeElaspedError);

    Ok(())
  }
}

