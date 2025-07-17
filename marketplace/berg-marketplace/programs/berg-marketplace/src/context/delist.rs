use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{close_account, transfer_checked, CloseAccount, TransferChecked}, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::state::{listing, Listing, Marketplace};

#[derive(Accounts)]
pub struct Delist<'info>{
    #[account(mut)]
    pub maker: Signer<'info>, // The NFT owner creating the listing

    #[account(
        seeds = [b"marketplace", marketplace.name.as_str().as_bytes()],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>, // The marketplace configuration account

    pub maker_mint: InterfaceAccount<'info, Mint>, // The NFT mint being listed
    #[account(
        mut,
        associated_token::mint = maker_mint,
        associated_token::authority = maker,
    )]
    pub maker_ata: InterfaceAccount<'info, TokenAccount>, // Token account holding the NFT

    #[account(
        associated_token::mint = maker_mint,
        associated_token::authority = listing,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>, // Escrow account for the NFT during listing

    #[account(
        seeds = [marketplace.key().as_ref(), maker_mint.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>, // Account to store listing information

    pub collection_mint: InterfaceAccount<'info, Mint>, // Collection the NFT belongs to
    
    // pub metadata_program: Program<'info, Metadata>, // Metaplex program
    pub associated_token_program: Program<'info, AssociatedToken>, // For creating ATAs
    pub system_program: Program<'info, System>, // For creating accounts
    pub token_program: Interface<'info, TokenInterface> // For token operations
}

impl <'info> Delist<'info> {
    pub fn remove_nft(&mut self) ->Result<()>{
      // [marketplace.key().as_ref(), maker_mint.key().as_ref()]
        let seeds = &[
          self.marketplace.to_account_info().key.as_ref(),
          self.maker_mint.to_account_info().key.as_ref(),
          &[self.listing.bump],
        ];
        let signers_seeds = &[&seeds[..]];

        let cpi_program = self.token_program.to_account_info();

        let cpi_accounts = TransferChecked{
            from: self.vault.to_account_info() , // Source of the NFT
            mint: self.maker_mint.to_account_info(), // NFT mint 
            to: self.maker.to_account_info(), // Destination vault
            authority: self.listing.to_account_info(), // Authority to move the token
        };

        let cpi_ctx = CpiContext::new_with_signer(
          cpi_program,
          cpi_accounts,
          signers_seeds
        );

        transfer_checked(cpi_ctx, self.maker_ata.amount, self.maker_mint.decimals)?;

        Ok(())
    }

    pub fn close_listing(&mut self, bumps: &DelistBumps) ->Result<()>{
      let seeds = &[
          self.marketplace.to_account_info().key.as_ref(),
          self.maker_mint.to_account_info().key.as_ref(),
          &[bumps.listing],
        ];
      let signers_seeds = &[&seeds[..]];

      let close_accounts = CloseAccount {
        account: self.listing.to_account_info(),
        destination: self.maker.to_account_info(),
        authority: self.maker.to_account_info(),
      };

      let close_cpi_ctx = CpiContext::new_with_signer(
        self.token_program.to_account_info(),
        close_accounts,
        signers_seeds,
      );

      close_account(close_cpi_ctx)?;

      Ok(())
    }
}
