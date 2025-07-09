use anchor_lang::prelude::*;

use anchor_spl::{
  associated_token::AssociatedToken,
  token_interface::{close_account, Mint, TokenAccount, TokenInterface, TransferChecked, CloseAccount}
};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
  #[account(mut)]
  pub taker: Signer<'info>,
  #[account(
    mint::token_program = token_program,
  )]
  pub maker: SystemAccount<'info>,
  #[account(mut)]
  pub mint_a: InterfaceAccount<'info, Mint>,
  #[account(
    mint::token_program = token_program,
  )]
  pub mint_b: InterfaceAccount<'info, Mint>,
  #[account(
    init_if_needed,
    payer = take,
    associated_token::mint = mint_b,
    associated_token::authority = maker,
    associated_token::token_program = token_program,
  )]
  pub maker_ata_b: InterfaceAccount<'info, TokenAccount>,
  #[account(
    mut,
    associated_token::mint = mint_b,
    associated_token::authority = taker,
    associated_token::token_program = token_program,
  )]
  pub taker_ata_b: InterfaceAccount<'info, TokenAccount>,
  #[account(
    mut,
    seeds = [b"escrow", escrow.maker.key().as_ref(), seed.to_le_bytes().as_ref()],
    bump = escrow.bump,
    close = maker,
  )]
  pub escrow: Account<'info, Escrow>,
  #[account(
    associated_token::mint = mint_a,
    associated_token::authority = escrow,
    associated_token::token_program = token_program,
  )]
  pub vault: InterfaceAccount<'info, TokenAccount>,
  pub associated_token_program: Program<'info, AssociatedToken>,
  pub token_program: Interface<'info, TokenInterface>,
  pub system_program: Program<'info, System>,
}

mod instructions;
use instructions::{};

impl<'info> Take<'info> {
  pub fn deposit(&mut self) -> Result<()> {
    let transfer_accounts = TransferChecked {
      from: self.taker_ata_b.to_account_info(),
      mint: self.mint_b.to_account_info(),
      to: self.maker_ata_b.to_account_info(),
      authority: self.taker.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(self.token_program.to_account_info(), transfer_accounts);

    transfer_checked(cpi_ctx, self.escrow.receive, self.mint_b.decimals)?;

    Ok(())
  }

  pub fn withdraw_and_close_vault(&mut self) -> Result<()> {
    let signer_seeds: [&[&[u8]]] = [&[
      b"escrow",
      self.maker.to_account_info().key.as_ref(),
      &self.escrow.seed.to_le_bytes()[..],
      &[self.escrow.bump],
    ]];

    let accounts = TransferChecked {
      from: self.vault.to_account_info(),
      mint: self.mint_a.to_account_info(),
      to: self.taker_ata_b.to_account_info(),
      authority: self.escrow.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
      self.token_program.to_account_info(),
      accounts,
      &signer_seeds,
    );

    transfer_checked(cpi_ctx, self.escrow.receive, self.mint_a.decimals)?;

    let accounts = CloseAccount {
      account: self.vault.to_account_info(),
      destination: self.maker.to_account_info(),
      authority: self.escrow.to_account_info(),
    };

    let ctx = CpiContext::new_with_signer(
      self.token_program.to_account_info(),
      accounts,
      &signer_seeds,
    );

    close_account(ctx)?;

    Ok(())
  }

}