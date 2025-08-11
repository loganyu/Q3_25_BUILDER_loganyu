// instructions/initialize.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ErrorCode;
use crate::events::*;
use crate::constants::*;

// Initialize Protocol
#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ProtocolAuthority::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol_authority: Account<'info, ProtocolAuthority>,
    
    /// CHECK: Fee recipient can be any account
    pub fee_recipient: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeProtocol<'info> {
    pub fn init_protocol(&mut self, fee_bps: u16, bumps: &InitializeProtocolBumps) -> Result<()> {
        require!(
            fee_bps <= MAX_FEE_BPS,
            ErrorCode::InvalidPercentage
        );
        
        self.protocol_authority.set_inner(ProtocolAuthority {
            program_id: crate::ID,
            fee_recipient: self.fee_recipient.key(),
            protocol_fee_bps: fee_bps,
            total_positions: 0,
            bump: bumps.protocol_authority,
        });
        
        msg!("Protocol initialized with fee: {} bps", fee_bps);
        Ok(())
    }
}

// Initialize User
#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserMainAccount::INIT_SPACE,
        seeds = [USER_SEED, owner.key().as_ref()],
        bump
    )]
    pub user_main_account: Account<'info, UserMainAccount>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeUser<'info> {
    pub fn init_user(&mut self, bumps: &InitializeUserBumps) -> Result<()> {
        self.user_main_account.set_inner(UserMainAccount {
            owner: self.owner.key(),
            position_count: 0,
            total_positions_created: 0,
            bump: bumps.user_main_account,
        });
        
        msg!("User main account initialized for: {}", self.owner.key());
        Ok(())
    }
}

// Create Position
#[derive(Accounts)]
#[instruction(position_id: u64, lp_range_min: u64, lp_range_max: u64)]
pub struct CreatePosition<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, owner.key().as_ref(), position_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    
    #[account(
        mut,
        seeds = [USER_SEED, owner.key().as_ref()],
        bump = user_main_account.bump,
        constraint = user_main_account.owner == owner.key()
    )]
    pub user_main_account: Box<Account<'info, UserMainAccount>>,
    
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol_authority.bump
    )]
    pub protocol_authority: Box<Account<'info, ProtocolAuthority>>, 
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_a_mint,
        associated_token::authority = position
    )]
    pub position_token_a_vault: Box<Account<'info, TokenAccount>>, 
    
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_b_mint,
        associated_token::authority = position
    )]
    pub position_token_b_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> CreatePosition<'info> {
    pub fn init_position(
        &mut self, 
        position_id: u64, 
        lp_range_min: u64, 
        lp_range_max: u64,
        bumps: &CreatePositionBumps
    ) -> Result<()> {
        require!(
            lp_range_min < lp_range_max,
            ErrorCode::InvalidPriceRange
        );
        
        require!(
            position_id == self.user_main_account.total_positions_created + 1,
            ErrorCode::InvalidPositionId
        );
        
        self.position.set_inner(Position {
            owner: self.owner.key(),
            position_id,
            token_a_mint: self.token_a_mint.key(),
            token_b_mint: self.token_b_mint.key(),
            
            // Token balances in different locations
            token_a_vault_balance: 0,
            token_b_vault_balance: 0,
            token_a_in_lp: 0,
            token_b_in_lp: 0,
            token_a_in_lending: 0,
            token_b_in_lending: 0,
            
            // LP range configuration
            lp_range_min,
            lp_range_max,
            
            // Position state
            pause_flag: false,
            created_at: Clock::get()?.unix_timestamp,
            
            // Rebalancing tracking
            last_rebalance_price: 0,
            last_rebalance_slot: 0,
            total_rebalances: 0,
            
            // External protocol position tracking (initially None)
            meteora_position: None,
            kamino_obligation: None,
            
            bump: bumps.position,
        });
        
        // Update user main account
        self.user_main_account.position_count += 1;
        self.user_main_account.total_positions_created += 1;
        
        // Update protocol stats
        self.protocol_authority.total_positions += 1;
        
        msg!(
            "Position {} created with range: {}-{}", 
            position_id, lp_range_min, lp_range_max
        );
        Ok(())
    }
}

// Deposit to Position
#[derive(Accounts)]
pub struct DepositToPosition<'info> {
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

impl<'info> DepositToPosition<'info> {
    pub fn deposit(&mut self, amount_a: u64, amount_b: u64) -> Result<()> {
        // Calculate fees
        let fee_a = (amount_a as u128)
            .checked_mul(self.protocol_authority.protocol_fee_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)? as u64;
            
        let fee_b = (amount_b as u128)
            .checked_mul(self.protocol_authority.protocol_fee_bps as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        
        let deposit_a = amount_a.checked_sub(fee_a).ok_or(ErrorCode::MathOverflow)?;
        let deposit_b = amount_b.checked_sub(fee_b).ok_or(ErrorCode::MathOverflow)?;
        
        // Transfer token A
        if amount_a > 0 {
            // Transfer deposit amount to vault
            anchor_spl::token::transfer(
                CpiContext::new(
                    self.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: self.user_token_a.to_account_info(),
                        to: self.position_token_a_vault.to_account_info(),
                        authority: self.owner.to_account_info(),
                    },
                ),
                deposit_a,
            )?;
            
            // Transfer fee
            if fee_a > 0 {
                anchor_spl::token::transfer(
                    CpiContext::new(
                        self.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: self.user_token_a.to_account_info(),
                            to: self.fee_token_a.to_account_info(),
                            authority: self.owner.to_account_info(),
                        },
                    ),
                    fee_a,
                )?;
            }
            
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_add(deposit_a)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        // Transfer token B
        if amount_b > 0 {
            // Transfer deposit amount to vault
            anchor_spl::token::transfer(
                CpiContext::new(
                    self.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: self.user_token_b.to_account_info(),
                        to: self.position_token_b_vault.to_account_info(),
                        authority: self.owner.to_account_info(),
                    },
                ),
                deposit_b,
            )?;
            
            // Transfer fee
            if fee_b > 0 {
                anchor_spl::token::transfer(
                    CpiContext::new(
                        self.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: self.user_token_b.to_account_info(),
                            to: self.fee_token_b.to_account_info(),
                            authority: self.owner.to_account_info(),
                        },
                    ),
                    fee_b,
                )?;
            }
            
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_add(deposit_b)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        emit!(DepositEvent {
            position_id: self.position.position_id,
            owner: self.position.owner,
            amount_a: deposit_a,
            amount_b: deposit_b,
            fee_a,
            fee_b,
        });
        
        msg!(
            "Deposited {} token A and {} token B (fees: {}, {})",
            deposit_a, deposit_b, fee_a, fee_b
        );
        Ok(())
    }
}

// Modify Position (Pause/Resume)
#[derive(Accounts)]
pub struct ModifyPosition<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Box<Account<'info, Position>>, 
    
    pub owner: Signer<'info>,
}

impl<'info> ModifyPosition<'info> {
    pub fn pause(&mut self) -> Result<()> {
        self.position.pause_flag = true;
        msg!("Position {} paused", self.position.position_id);
        Ok(())
    }
    
    pub fn resume(&mut self) -> Result<()> {
        self.position.pause_flag = false;
        msg!("Position {} resumed", self.position.position_id);
        Ok(())
    }
}