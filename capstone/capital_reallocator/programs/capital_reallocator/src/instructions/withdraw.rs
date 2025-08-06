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
    pub position: Account<'info, Position>,
    
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol_authority.bump
    )]
    pub protocol_authority: Account<'info, ProtocolAuthority>,
    
    #[account(
        mut,
        constraint = user_token_a.owner == owner.key(),
        constraint = user_token_a.mint == position.token_a_mint
    )]
    pub user_token_a: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = user_token_b.owner == owner.key(),
        constraint = user_token_b.mint == position.token_b_mint
    )]
    pub user_token_b: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = token_a_mint,
        associated_token::authority = position
    )]
    pub position_token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = position
    )]
    pub position_token_b_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = fee_token_a.owner == protocol_authority.fee_recipient,
        constraint = fee_token_a.mint == position.token_a_mint
    )]
    pub fee_token_a: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = fee_token_b.owner == protocol_authority.fee_recipient,
        constraint = fee_token_b.mint == position.token_b_mint
    )]
    pub fee_token_b: Account<'info, TokenAccount>,
    
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
        
        // Calculate total balances
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
        
        // Calculate fees on withdrawal
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
        
        // Extract values before creating signer seeds to avoid borrow checker issues
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
        
        // Transfer from vault to user (only vault balance for now)
        // In production, you'd need to close LP/lending positions first
        if net_withdraw_a > 0 && self.position.token_a_vault_balance >= withdraw_a {
            // Transfer to user
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
                net_withdraw_a,
            )?;
            
            // Transfer fee
            if fee_a > 0 {
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
                    fee_a,
                )?;
            }
            
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_sub(withdraw_a)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        if net_withdraw_b > 0 && self.position.token_b_vault_balance >= withdraw_b {
            // Transfer to user
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
                net_withdraw_b,
            )?;
            
            // Transfer fee
            if fee_b > 0 {
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
                    fee_b,
                )?;
            }
            
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_sub(withdraw_b)
                .ok_or(ErrorCode::MathOverflow)?;
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
            "Withdrew {}% - {} token A, {} token B",
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
        close = owner
    )]
    pub position_token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = token_b_mint,
        associated_token::authority = position,
        close = owner
    )]
    pub position_token_b_vault: Account<'info, TokenAccount>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
        
        // Update counters
        self.user_main_account.position_count = self.user_main_account.position_count.saturating_sub(1);
        self.protocol_authority.total_positions = self.protocol_authority.total_positions.saturating_sub(1);
        
        msg!("Position {} closed", self.position.position_id);
        Ok(())
    }
}
