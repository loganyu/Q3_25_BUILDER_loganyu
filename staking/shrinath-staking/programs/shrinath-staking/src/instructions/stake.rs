use anchor_lang::prelude::*;

use crate::state::{StakeAccount, StakeConfig, UserAccount};

#[derive(Accounts)]
pub struct Stake<'info> {
  #[account(mut)]
  pub user: Signer<'info>,

  pub mint: Account<'info, Mint>,

  pub collection_mint: Account<'info, Mint>,

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
    ],
    seeds::program = metadata_program.key(),
    bump,
    constraint = metadata.collection.as_ref().unwrap().key.as_ref() == collection_mint.key().as_ref(),
    constraint = metadata.collection.as_ref().unwrap().verified == true
  )]
  pub metadata: Account<'info, MetadataAccount>,

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
    space = 8 + UserAccount::INIT_SPACE,
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

impl<'info> Stake<'info> {

}