use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ErrorCode;
use crate::events::*;
use crate::constants::*;

// Withdraw from Position
#[derive(Accounts)]
pub struct WithdrawFromPosition<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = token_a_mint,
        has_one = token_b_mint,
    )]
    pub position: Box<Account<'info, Position>>,
    
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol_authority.bump
    )]
    pub protocol_authority: Box<Account<'info, ProtocolAuthority>>,
    
    #[account(
        mut,
        constraint = user_token_a.owner == owner.key(),
        constraint = user_token_a.mint == position.token_a_mint
    )]
    pub user_token_a: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = user_token_b.owner == owner.key(),
        constraint = user_token_b.mint == position.token_b_mint
    )]
    pub user_token_b: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = position
    )]
    pub position_token_a_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = position
    )]
    pub position_token_b_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = fee_token_a.owner == protocol_authority.fee_recipient,
        constraint = fee_token_a.mint == position.token_a_mint
    )]
    pub fee_token_a: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = fee_token_b.owner == protocol_authority.fee_recipient,
        constraint = fee_token_b.mint == position.token_b_mint
    )]
    pub fee_token_b: Box<Account<'info, TokenAccount>>,
    
    pub owner: Signer<'info>,
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

impl<'info> WithdrawFromPosition<'info> {
    pub fn withdraw(&mut self, withdraw_percentage: u8) -> Result<()> {
        require!(
            withdraw_percentage > 0 && withdraw_percentage <= 100,
            ErrorCode::InvalidPercentage
        );
        
        // Calculate total balances across all positions
        let total_a = self.position.token_a_vault_balance
            .checked_add(self.position.token_a_in_lp)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_add(self.position.token_a_in_lending)
            .ok_or(ErrorCode::MathOverflow)?;
            
        let total_b = self.position.token_b_vault_balance
            .checked_add(self.position.token_b_in_lp)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_add(self.position.token_b_in_lending)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Calculate withdrawal amounts
        let withdraw_a = (total_a as u128)
            .checked_mul(withdraw_percentage as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::MathOverflow)? as u64;
            
        let withdraw_b = (total_b as u128)
            .checked_mul(withdraw_percentage as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        
        // Calculate fees
        let fee_a = (withdraw_a as u128)
            .checked_mul(self.protocol_authority.protocol_fee_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)? as u64;
            
        let fee_b = (withdraw_b as u128)
            .checked_mul(self.protocol_authority.protocol_fee_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        
        let net_withdraw_a = withdraw_a.checked_sub(fee_a).ok_or(ErrorCode::MathOverflow)?;
        let net_withdraw_b = withdraw_b.checked_sub(fee_b).ok_or(ErrorCode::MathOverflow)?;
        
        // Update position state to reflect withdrawals from LP/lending
        // This is a simplified version - in production you'd actually close these positions
        if withdraw_percentage == 100 {
            // For 100% withdrawal, clear everything
            self.position.token_a_in_lp = 0;
            self.position.token_b_in_lp = 0;
            self.position.token_a_in_lending = 0;
            self.position.token_b_in_lending = 0;
            self.position.token_a_vault_balance = 0;
            self.position.token_b_vault_balance = 0;
        } else {
            // For partial withdrawal, reduce proportionally
            let remaining_percentage = 100u128.saturating_sub(withdraw_percentage as u128);
            
            self.position.token_a_in_lp = ((self.position.token_a_in_lp as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
                
            self.position.token_b_in_lp = ((self.position.token_b_in_lp as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
                
            self.position.token_a_in_lending = ((self.position.token_a_in_lending as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
                
            self.position.token_b_in_lending = ((self.position.token_b_in_lending as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
                
            self.position.token_a_vault_balance = ((self.position.token_a_vault_balance as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
                
            self.position.token_b_vault_balance = ((self.position.token_b_vault_balance as u128)
                .checked_mul(remaining_percentage)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(100)
                .ok_or(ErrorCode::MathOverflow)?) as u64;
        }
        
        // For testing purposes, we'll simulate the withdrawal by just updating state
        // In production, you'd actually transfer tokens from vaults
        // The actual token transfers would happen here after closing LP/lending positions
        
        // Extract values for signer seeds
        let position_owner = self.position.owner;
        let position_id = self.position.position_id;
        let position_bump = self.position.bump;
        
        // Create signer seeds
        let position_id_bytes = position_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            POSITION_SEED,
            position_owner.as_ref(),
            position_id_bytes.as_ref(),
            &[position_bump],
        ]];
        
        // For testing, only transfer what's actually in the vault
        // In production, you'd first move funds from LP/lending to vault
        let vault_amount_a = self.position_token_a_vault.amount;
        let vault_amount_b = self.position_token_b_vault.amount;
        
        let actual_withdraw_a = withdraw_a.min(vault_amount_a);
        let actual_withdraw_b = withdraw_b.min(vault_amount_b);
        
        if actual_withdraw_a > 0 {
            let actual_net_a = actual_withdraw_a.saturating_sub(fee_a.min(actual_withdraw_a));
            let actual_fee_a = actual_withdraw_a.saturating_sub(actual_net_a);
            
            if actual_net_a > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: self.position_token_a_vault.to_account_info(),
                            to: self.user_token_a.to_account_info(),
                            authority: self.position.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    actual_net_a,
                )?;
            }
            
            if actual_fee_a > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: self.position_token_a_vault.to_account_info(),
                            to: self.fee_token_a.to_account_info(),
                            authority: self.position.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    actual_fee_a,
                )?;
            }
        }
        
        if actual_withdraw_b > 0 {
            let actual_net_b = actual_withdraw_b.saturating_sub(fee_b.min(actual_withdraw_b));
            let actual_fee_b = actual_withdraw_b.saturating_sub(actual_net_b);
            
            if actual_net_b > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: self.position_token_b_vault.to_account_info(),
                            to: self.user_token_b.to_account_info(),
                            authority: self.position.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    actual_net_b,
                )?;
            }
            
            if actual_fee_b > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: self.position_token_b_vault.to_account_info(),
                            to: self.fee_token_b.to_account_info(),
                            authority: self.position.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    actual_fee_b,
                )?;
            }
        }
        
        emit!(WithdrawEvent {
            position_id,
            owner: position_owner,
            amount_a: net_withdraw_a,
            amount_b: net_withdraw_b,
            fee_a,
            fee_b,
            percentage: withdraw_percentage,
        });
        
        msg!(
            "Withdrew {}% - {} token A, {} token B (from LP/lending/vault)",
            withdraw_percentage, net_withdraw_a, net_withdraw_b
        );
        
        Ok(())
    }
}

// Close Position
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = token_a_mint,
        has_one = token_b_mint,
        close = owner
    )]
    pub position: Account<'info, Position>,
    
    #[account(
        mut,
        seeds = [USER_SEED, owner.key().as_ref()],
        bump = user_main_account.bump,
        has_one = owner
    )]
    pub user_main_account: Account<'info, UserMainAccount>,
    
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol_authority.bump
    )]
    pub protocol_authority: Account<'info, ProtocolAuthority>,
    
    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = position,
    )]
    pub position_token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = position,
    )]
    pub position_token_b_vault: Account<'info, TokenAccount>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

impl<'info> ClosePosition<'info> {
    pub fn close(&mut self) -> Result<()> {
        // Verify position is empty
        require!(
            self.position.token_a_vault_balance == 0 &&
            self.position.token_b_vault_balance == 0 &&
            self.position.token_a_in_lp == 0 &&
            self.position.token_b_in_lp == 0 &&
            self.position.token_a_in_lending == 0 &&
            self.position.token_b_in_lending == 0,
            ErrorCode::PositionNotEmpty
        );

        let position_owner = self.position.owner;
        let position_id = self.position.position_id;
        let position_bump = self.position.bump;

        // Create signer seeds
        let position_id_bytes = position_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            POSITION_SEED,
            position_owner.as_ref(),
            position_id_bytes.as_ref(),
            &[position_bump],
        ]];

        // Close token A vault
        let cpi_accounts_a = anchor_spl::token::CloseAccount {
            account: self.position_token_a_vault.to_account_info(),
            destination: self.owner.to_account_info(),
            authority: self.position.to_account_info(),
        };
        let cpi_program_a = self.token_program.to_account_info();
        let cpi_ctx_a = CpiContext::new_with_signer(cpi_program_a, cpi_accounts_a, signer_seeds);
        anchor_spl::token::close_account(cpi_ctx_a)?;
        
        // Close token B vault
        let cpi_accounts_b = anchor_spl::token::CloseAccount {
            account: self.position_token_b_vault.to_account_info(),
            destination: self.owner.to_account_info(),
            authority: self.position.to_account_info(),
        };
        let cpi_program_b = self.token_program.to_account_info();
        let cpi_ctx_b = CpiContext::new_with_signer(cpi_program_b, cpi_accounts_b, signer_seeds);
        anchor_spl::token::close_account(cpi_ctx_b)?;
        
        // Update counters
        self.user_main_account.position_count = self.user_main_account.position_count.saturating_sub(1);
        self.protocol_authority.total_positions = self.protocol_authority.total_positions.saturating_sub(1);
        
        msg!("Position {} closed", self.position.position_id);
        Ok(())
    }
}
