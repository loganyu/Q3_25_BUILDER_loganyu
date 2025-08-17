// instructions/rebalance.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};
use crate::state::*;
use crate::errors::ErrorCode;
use crate::events::{PositionStatusEvent, RebalanceEvent, RebalanceAction};
use crate::constants::*;

pub const SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// Real Meteora DLMM Program ID
pub const METEORA_DLMM_PROGRAM: &str = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
// Real Kamino Lending Program ID  
pub const KAMINO_LENDING_PROGRAM: &str = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
// Real Jupiter Aggregator Program ID
pub const JUPITER_PROGRAM: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

#[derive(Accounts)]
pub struct CheckPositionStatus<'info> {
    #[account(
        seeds = [POSITION_SEED, position.owner.as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    
    pub price_update: Account<'info, PriceUpdateV2>,
}

impl<'info> CheckPositionStatus<'info> {
    pub fn check_status(&self) -> Result<()> {
        // Get the price feed ID (using SOL/USD for SOL positions)
        let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
        // Get price with maximum age of 30 seconds
        let maximum_age: u64 = 30;
        let price_data = self.price_update.get_price_no_older_than(
            &Clock::get()?,
            maximum_age,
            &feed_id
        )?;

        // Convert price to 6 decimals (USD standard)
        let current_price = normalize_pyth_price(
            price_data.price,
            price_data.exponent,
            6
        )?;
        
        // Check if price is in range
        let in_range = current_price >= self.position.lp_range_min && 
                       current_price <= self.position.lp_range_max;
        
        msg!(
            "Position {} - Current price: {}, Range: {}-{}, In range: {}",
            self.position.position_id,
            current_price,
            self.position.lp_range_min,
            self.position.lp_range_max,
            in_range
        );
        
        emit!(PositionStatusEvent {
            position_id: self.position.position_id,
            owner: self.position.owner,
            current_price,
            in_range,
            has_lp: self.position.token_a_in_lp > 0 || self.position.token_b_in_lp > 0,
            has_lending: self.position.token_a_in_lending > 0 || self.position.token_b_in_lending > 0,
        });
        
        Ok(())
    }
}

// Rebalance Position with Meteora Integration
#[derive(Accounts)]
pub struct RebalancePosition<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, position.owner.as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    
    pub price_update: Account<'info, PriceUpdateV2>,

    // Position token vaults
    #[account(
        mut,
        constraint = position_token_a_vault.owner == position.key(),
        constraint = position_token_a_vault.mint == position.token_a_mint
    )]
    pub position_token_a_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = position_token_b_vault.owner == position.key(),
        constraint = position_token_b_vault.mint == position.token_b_mint
    )]
    pub position_token_b_vault: Box<Account<'info, TokenAccount>>,

    // Meteora DLMM Accounts
    /// CHECK: Meteora DLMM program
    #[account(constraint = meteora_program.key() == METEORA_DLMM_PROGRAM.parse::<Pubkey>().unwrap())]
    pub meteora_program: UncheckedAccount<'info>,

    /// CHECK: Meteora LB pair account
    pub meteora_lb_pair: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora position account
    #[account(mut)]
    pub meteora_position: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora reserve X
    #[account(mut)]
    pub meteora_reserve_x: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora reserve Y
    #[account(mut)]
    pub meteora_reserve_y: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora bin arrays
    #[account(mut)]
    pub meteora_bin_array_lower: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub meteora_bin_array_upper: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora bin array bitmap extension (optional)
    #[account(mut)]
    pub meteora_bin_array_bitmap_extension: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora event authority
    pub meteora_event_authority: Option<UncheckedAccount<'info>>,
    
    // Token mints (needed for Meteora CPI)
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    // Kamino Lending Accounts (for future implementation)
    /// CHECK: Kamino lending program
    #[account(constraint = kamino_program.key() == KAMINO_LENDING_PROGRAM.parse::<Pubkey>().unwrap())]
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: Kamino lending market
    pub kamino_lending_market: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Kamino obligation account
    pub kamino_obligation: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Kamino reserve accounts
    pub kamino_reserve_a: Option<UncheckedAccount<'info>>,
    pub kamino_reserve_b: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Jupiter aggregator program
    #[account(constraint = jupiter_program.key() == JUPITER_PROGRAM.parse::<Pubkey>().unwrap())]
    pub jupiter_program: UncheckedAccount<'info>,
    
    // Required system accounts
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

impl<'info> RebalancePosition<'info> {
    pub fn rebalance(&mut self) -> Result<()> {
        // Check if position is paused
        require!(!self.position.pause_flag, ErrorCode::PositionPaused);

        // Get price from Pyth
        let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
        let maximum_age: u64 = 60; // 60 seconds max staleness

        let price_data = self.price_update.get_price_no_older_than(
            &Clock::get()?,
            maximum_age,
            &feed_id
        )?;

        // Normalize price to 6 decimals (USD standard)
        let current_price = normalize_pyth_price(
            price_data.price,
            price_data.exponent,
            6
        )?;

        let confidence = normalize_pyth_price(
            price_data.conf as i64,
            price_data.exponent,
            6
        )?;
        
        // Calculate price bounds with confidence interval
        let price_lower = current_price.saturating_sub(confidence);
        let price_upper = current_price.saturating_add(confidence);
        
        // Check if price is definitively in or out of range
        let definitely_in_range = price_lower >= self.position.lp_range_min && 
                                  price_upper <= self.position.lp_range_max;
        let definitely_out_of_range = price_upper < self.position.lp_range_min || 
                                      price_lower > self.position.lp_range_max;
        
        // If price is in the uncertain zone (overlapping range boundary), don't rebalance
        if !definitely_in_range && !definitely_out_of_range {
            msg!("Price uncertain at range boundary, skipping rebalance");
            emit!(RebalanceEvent {
                position_id: self.position.position_id,
                owner: self.position.owner,
                current_price,
                in_range: false,
                action: RebalanceAction::NoAction,
            });
            return Ok(());
        }
        
        let in_range = definitely_in_range;

        // Check rebalance threshold
        if !self.should_rebalance(current_price, in_range)? {
            msg!("Rebalance threshold not met, skipping");
            emit!(RebalanceEvent {
                position_id: self.position.position_id,
                owner: self.position.owner,
                current_price,
                in_range,
                action: RebalanceAction::NoAction,
            });
            return Ok(());
        }
        
        // Execute rebalancing logic
        let action = self.execute_rebalance(in_range, current_price)?;
        
        // Update tracking
        self.position.last_rebalance_price = current_price;
        self.position.last_rebalance_slot = Clock::get()?.slot;
        self.position.total_rebalances = self.position.total_rebalances.saturating_add(1);
        
        emit!(RebalanceEvent {
            position_id: self.position.position_id,
            owner: self.position.owner,
            current_price,
            in_range,
            action,
        });
        
        Ok(())
    }

    fn should_rebalance(&self, current_price: u64, in_range: bool) -> Result<bool> {
        // Check if enough time has passed since last rebalance
        let current_slot = Clock::get()?.slot;
        let slots_since_rebalance = current_slot.saturating_sub(self.position.last_rebalance_slot);
        
        // Minimum ~10 seconds between rebalances (25 slots)
        const MIN_SLOTS_BETWEEN_REBALANCES: u64 = 25;
        
        if slots_since_rebalance < MIN_SLOTS_BETWEEN_REBALANCES {
            msg!("Too soon since last rebalance: {} slots", slots_since_rebalance);
            return Ok(false);
        }
        
        // Check price movement threshold (1% minimum)
        if self.position.last_rebalance_price > 0 {
            let price_change = if current_price > self.position.last_rebalance_price {
                current_price - self.position.last_rebalance_price
            } else {
                self.position.last_rebalance_price - current_price
            };
            
            let price_change_bps = price_change
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                / self.position.last_rebalance_price;
            
            if price_change_bps < REBALANCE_THRESHOLD_BPS as u64 {
                msg!("Price change {}bps below threshold {}bps", price_change_bps, REBALANCE_THRESHOLD_BPS);
                return Ok(false);
            }
        }
        
        // Check if position state actually needs rebalancing
        let has_lp = self.position.token_a_in_lp > 0 || self.position.token_b_in_lp > 0;
        let has_lending = self.position.token_a_in_lending > 0 || self.position.token_b_in_lending > 0;
        let has_idle = self.position.token_a_vault_balance > 0 || self.position.token_b_vault_balance > 0;
        
        let needs_rebalance = (in_range && has_lending) ||  // Should be in LP but in lending
                             (!in_range && has_lp) ||        // Should be in lending but in LP
                             has_idle;                        // Has idle funds to deploy
        
        Ok(needs_rebalance)
    }

    fn execute_rebalance(&mut self, in_range: bool, current_price: u64) -> Result<RebalanceAction> {
        let has_lp = self.position.token_a_in_lp > 0 || self.position.token_b_in_lp > 0;
        let has_lending = self.position.token_a_in_lending > 0 || self.position.token_b_in_lending > 0;
        let has_idle = self.position.token_a_vault_balance > 0 || self.position.token_b_vault_balance > 0;
        
        msg!(
            "Executing rebalance - Price: ${}, In range: {}, LP: {}, Lending: {}, Idle: {}",
            current_price / 10u64.pow(6), in_range, has_lp, has_lending, has_idle
        );
        
        if in_range {
            if has_lending {
                msg!("Moving from lending to LP");
                self.withdraw_from_kamino()?;
            }
            if has_idle || has_lending {
                // Balance tokens first (before borrowing accounts)
                self.balance_tokens_for_lp(current_price)?;
                self.open_meteora_position(current_price)?;
                Ok(RebalanceAction::MoveToLP)
            } else {
                Ok(RebalanceAction::NoAction)
            }
        } else {
            if has_lp {
                msg!("Moving from LP to lending");
                self.close_meteora_position()?;
            }
            if has_idle || has_lp {
                self.deposit_to_kamino()?;
                Ok(RebalanceAction::MoveToLending)
            } else {
                Ok(RebalanceAction::NoAction)
            }
        }
    }
    
    fn withdraw_from_kamino(&mut self) -> Result<()> {
        msg!("Withdrawing from Kamino lending...");
        
        // Get current balances
        let lending_a = self.position.token_a_in_lending;
        let lending_b = self.position.token_b_in_lending;
        
        if lending_a == 0 && lending_b == 0 {
            msg!("No funds in Kamino lending");
            return Ok(());
        }
        
        // Check if we have lending accounts provided
        let kamino_lending_market = self.kamino_lending_market.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;
        let kamino_obligation = self.kamino_obligation.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;
        let kamino_reserve_a = self.kamino_reserve_a.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;
        let kamino_reserve_b = self.kamino_reserve_b.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;
        
        // Execute Kamino withdrawal CPI
        let position_account_info = self.position.to_account_info();
        
        if lending_a > 0 {
            // Create temporary collateral account reference
            let source_collateral_a = kamino_reserve_a.to_account_info();
            
            self.position.withdraw_from_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &source_collateral_a,
                &self.position_token_a_vault,
                kamino_reserve_a,
                kamino_reserve_a, // Reserve liquidity supply
                kamino_reserve_a, // Reserve collateral mint  
                kamino_lending_market,
                kamino_lending_market, // Market authority (derived)
                kamino_obligation,
                &position_account_info, // Owner is the position PDA
                &self.clock,
                &self.token_program,
                lending_a,
            )?;
            
            // Update position state
            self.position.token_a_in_lending = 0;
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_add(lending_a)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        if lending_b > 0 {
            // Create temporary collateral account reference
            let source_collateral_b = kamino_reserve_b.to_account_info();
            
            self.position.withdraw_from_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &source_collateral_b,
                &self.position_token_b_vault,
                kamino_reserve_b,
                kamino_reserve_b, // Reserve liquidity supply
                kamino_reserve_b, // Reserve collateral mint
                kamino_lending_market,
                kamino_lending_market, // Market authority (derived)
                kamino_obligation,
                &position_account_info, // Owner is the position PDA
                &self.clock,
                &self.token_program,
                lending_b,
            )?;
            
            // Update position state
            self.position.token_b_in_lending = 0;
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_add(lending_b)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        msg!("Withdrew {} A and {} B from Kamino", lending_a, lending_b);
        Ok(())
    }
    
    fn deposit_to_kamino(&mut self) -> Result<()> {
        msg!("Depositing to Kamino lending...");
        
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        if vault_a == 0 && vault_b == 0 {
            msg!("No idle funds to deposit to Kamino");
            return Ok(());
        }
        
        // Check if we have lending accounts provided
        let kamino_lending_market = self.kamino_lending_market.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let kamino_obligation = self.kamino_obligation.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let kamino_reserve_a = self.kamino_reserve_a.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let kamino_reserve_b = self.kamino_reserve_b.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        
        // Initialize obligation if needed
        if self.position.kamino_obligation.is_none() {
            let position_account_info = self.position.to_account_info();
            self.position.init_kamino_obligation_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                kamino_lending_market,
                kamino_obligation,
                &position_account_info,
                &self.clock,
                &self.rent,
                &self.token_program,
            )?;
        }
        
        // Execute Kamino deposit CPI
        let position_account_info = self.position.to_account_info();
        
        if vault_a > 0 {
            // Create temporary collateral destination
            let destination_collateral_a = kamino_reserve_a.to_account_info();
            
            self.position.deposit_to_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &self.position_token_a_vault,
                &destination_collateral_a,
                kamino_reserve_a,
                kamino_reserve_a, // Reserve liquidity supply
                kamino_reserve_a, // Reserve collateral mint
                kamino_lending_market,
                kamino_lending_market, // Market authority (derived)
                kamino_obligation,
                &position_account_info,
                &self.clock,
                &self.token_program,
                vault_a,
            )?;
            
            // Update position state
            self.position.token_a_vault_balance = 0;
            self.position.token_a_in_lending = self.position.token_a_in_lending
                .checked_add(vault_a)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        if vault_b > 0 {
            // Create temporary collateral destination
            let destination_collateral_b = kamino_reserve_b.to_account_info();
            
            self.position.deposit_to_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &self.position_token_b_vault,
                &destination_collateral_b,
                kamino_reserve_b,
                kamino_reserve_b, // Reserve liquidity supply
                kamino_reserve_b, // Reserve collateral mint
                kamino_lending_market,
                kamino_lending_market, // Market authority (derived)
                kamino_obligation,
                &position_account_info,
                &self.clock,
                &self.token_program,
                vault_b,
            )?;
            
            // Update position state
            self.position.token_b_vault_balance = 0;
            self.position.token_b_in_lending = self.position.token_b_in_lending
                .checked_add(vault_b)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        msg!("Deposited {} A and {} B to Kamino", vault_a, vault_b);
        Ok(())
    }
    
    fn close_meteora_position(&mut self) -> Result<()> {
        msg!("Closing Meteora DLMM position...");
        
        let lp_a = self.position.token_a_in_lp;
        let lp_b = self.position.token_b_in_lp;
        
        if lp_a == 0 && lp_b == 0 {
            msg!("No Meteora liquidity to close");
            return Ok(());
        }
        
        // Get required Meteora accounts (to avoid borrowing conflicts)
        let meteora_lb_pair = self.meteora_lb_pair.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_position = self.meteora_position.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_reserve_x = self.meteora_reserve_x.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_reserve_y = self.meteora_reserve_y.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_bin_array_lower = self.meteora_bin_array_lower.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_bin_array_upper = self.meteora_bin_array_upper.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        let meteora_event_authority = self.meteora_event_authority.as_ref()
            .ok_or(ErrorCode::LPPositionNotFound)?;
        
        // Execute Meteora remove liquidity CPI
        let position_account_info = self.position.to_account_info();
        self.position.close_meteora_position_cpi(
            &position_account_info,
            &self.meteora_program,
            meteora_lb_pair,
            meteora_position,
            &self.position_token_a_vault,
            &self.position_token_b_vault,
            meteora_reserve_x,
            meteora_reserve_y,
            &self.token_a_mint,
            &self.token_b_mint,
            meteora_bin_array_lower,
            meteora_bin_array_upper,
            &self.token_program,
            meteora_event_authority,
        )?;
        
        Ok(())
    }
    
    fn open_meteora_position(&mut self, current_price: u64) -> Result<()> {
        msg!("Opening Meteora DLMM position...");
        
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        if vault_a == 0 && vault_b == 0 {
            msg!("No idle funds to open Meteora position");
            return Ok(());
        }
        
        // Get required Meteora accounts (to avoid borrowing conflicts)
        let meteora_lb_pair = self.meteora_lb_pair.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_position = self.meteora_position.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_reserve_x = self.meteora_reserve_x.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_reserve_y = self.meteora_reserve_y.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_bin_array_lower = self.meteora_bin_array_lower.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_bin_array_upper = self.meteora_bin_array_upper.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        let meteora_event_authority = self.meteora_event_authority.as_ref()
            .ok_or(ErrorCode::ExternalProtocolError)?;
        
        // Execute Meteora add liquidity CPI
        let position_account_info = self.position.to_account_info();
        self.position.open_meteora_position_cpi(
            &position_account_info.to_account_info(),
            &self.meteora_program,
            meteora_lb_pair,
            meteora_position,
            &self.position_token_a_vault,
            &self.position_token_b_vault,
            meteora_reserve_x,
            meteora_reserve_y,
            &self.token_a_mint,
            &self.token_b_mint,
            meteora_bin_array_lower,
            meteora_bin_array_upper,
            &self.token_program,
            &self.system_program,
            &self.rent,
            meteora_event_authority,
            vault_a,
            vault_b,
            current_price,
        )?;
        
        Ok(())
    }

    // Jupiter Integration for token balancing (placeholder for now)
    fn balance_tokens_for_lp(&mut self, current_price: u64) -> Result<()> {
        msg!("Balancing tokens using Jupiter...");
        
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        // Calculate optimal ratio based on current price
        // For a 50/50 LP position: value_a should equal value_b
        let total_value_a = vault_a; // Already in USD terms
        let total_value_b = vault_b.checked_mul(current_price)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10u64.pow(9)) // Convert from 9 decimals to 6 decimals
            .ok_or(ErrorCode::MathOverflow)?;
        
        let total_value = total_value_a.checked_add(total_value_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        if total_value == 0 {
            return Ok(());
        }
        
        let target_value_each = total_value / 2;
        
        // Determine swap direction and amount
        if total_value_a > target_value_each {
            // Too much token A, swap some A for B
            let excess_a = total_value_a - target_value_each;
            msg!("Would swap {} A for B using Jupiter", excess_a);
        } else if total_value_b > target_value_each {
            // Too much token B, swap some B for A
            let excess_value_b = total_value_b - target_value_each;
            let excess_b = excess_value_b.checked_mul(10u64.pow(9))
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(current_price)
                .ok_or(ErrorCode::MathOverflow)?;
            
            msg!("Would swap {} B for A using Jupiter", excess_b);
        }
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct WithdrawFromMeteora<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    
    #[account(
        mut,
        constraint = position_token_a_vault.owner == position.key(),
        constraint = position_token_a_vault.mint == position.token_a_mint
    )]
    pub position_token_a_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = position_token_b_vault.owner == position.key(),
        constraint = position_token_b_vault.mint == position.token_b_mint
    )]
    pub position_token_b_vault: Box<Account<'info, TokenAccount>>,
    
    // Meteora accounts
    /// CHECK: Meteora program
    pub meteora_program: UncheckedAccount<'info>,
    /// CHECK: Meteora LB pair
    pub meteora_lb_pair: UncheckedAccount<'info>,
    /// CHECK: Meteora position
    #[account(mut)]
    pub meteora_position: UncheckedAccount<'info>,
    /// CHECK: Meteora reserves
    #[account(mut)]
    pub meteora_reserve_x: UncheckedAccount<'info>,
    /// CHECK: Meteora reserves
    #[account(mut)]
    pub meteora_reserve_y: UncheckedAccount<'info>,
    /// CHECK: Meteora bin arrays
    #[account(mut)]
    pub meteora_bin_array_lower: UncheckedAccount<'info>,
    /// CHECK: Meteora event authority
    #[account(mut)]
    pub meteora_bin_array_upper: UncheckedAccount<'info>,
    /// CHECK: Meteora event authority
    pub meteora_event_authority: UncheckedAccount<'info>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

impl<'info> WithdrawFromMeteora<'info> {
    pub fn withdraw_from_lp(&mut self) -> Result<()> {
        let lp_a = self.position.token_a_in_lp;
        let lp_b = self.position.token_b_in_lp;
        
        if lp_a == 0 && lp_b == 0 {
            msg!("No funds in Meteora LP to withdraw");
            return Ok(());
        }
        
        msg!("Withdrawing {} A and {} B from Meteora LP", lp_a, lp_b);
        
        // Execute Meteora withdrawal
        let position_account_info = self.position.to_account_info();
        self.position.close_meteora_position_cpi(
            &position_account_info,
            &self.meteora_program,
            &self.meteora_lb_pair,
            &self.meteora_position,
            &self.position_token_a_vault,
            &self.position_token_b_vault,
            &self.meteora_reserve_x,
            &self.meteora_reserve_y,
            &self.token_a_mint,
            &self.token_b_mint,
            &self.meteora_bin_array_lower,
            &self.meteora_bin_array_upper,
            &self.token_program,
            &self.meteora_event_authority,
        )?;
        
        // Update position state
        let withdrawn_a = self.position.token_a_in_lp;
        let withdrawn_b = self.position.token_b_in_lp;
        
        self.position.token_a_in_lp = 0;
        self.position.token_b_in_lp = 0;
        self.position.token_a_vault_balance = self.position.token_a_vault_balance
            .checked_add(withdrawn_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.position.token_b_vault_balance = self.position.token_b_vault_balance
            .checked_add(withdrawn_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        self.position.meteora_position = None;
        
        msg!("Successfully withdrew {} A and {} B from Meteora", withdrawn_a, withdrawn_b);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct WithdrawFromKamino<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, owner.key().as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    
    #[account(
        mut,
        constraint = position_token_a_vault.owner == position.key(),
        constraint = position_token_a_vault.mint == position.token_a_mint
    )]
    pub position_token_a_vault: Box<Account<'info, TokenAccount>>,
    
    #[account(
        mut,
        constraint = position_token_b_vault.owner == position.key(),
        constraint = position_token_b_vault.mint == position.token_b_mint
    )]
    pub position_token_b_vault: Box<Account<'info, TokenAccount>>,
    
    // Kamino accounts
    /// CHECK: Kamino program
    pub kamino_program: UncheckedAccount<'info>,
    /// CHECK: Kamino lending market
    pub kamino_lending_market: UncheckedAccount<'info>,
    /// CHECK: Kamino obligation
    #[account(mut)]
    pub kamino_obligation: UncheckedAccount<'info>,
    /// CHECK: Kamino reserves
    #[account(mut)]
    pub kamino_reserve_a: UncheckedAccount<'info>,
    /// CHECK: Kamino reserves
    #[account(mut)]
    pub kamino_reserve_b: UncheckedAccount<'info>,
    
    pub owner: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub token_program: Program<'info, Token>,
}

impl<'info> WithdrawFromKamino<'info> {
    pub fn withdraw_from_lending(&mut self) -> Result<()> {
        let lending_a = self.position.token_a_in_lending;
        let lending_b = self.position.token_b_in_lending;
        
        if lending_a == 0 && lending_b == 0 {
            msg!("No funds in Kamino lending to withdraw");
            return Ok(());
        }
        
        msg!("Withdrawing {} A and {} B from Kamino lending", lending_a, lending_b);
        
        let position_account_info = self.position.to_account_info();
        
        // Withdraw token A from Kamino
        if lending_a > 0 {
            let source_collateral_a = self.kamino_reserve_a.to_account_info();
            
            self.position.withdraw_from_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &source_collateral_a,
                &self.position_token_a_vault,
                &self.kamino_reserve_a,
                &self.kamino_reserve_a, // Reserve liquidity supply
                &self.kamino_reserve_a, // Reserve collateral mint
                &self.kamino_lending_market,
                &self.kamino_lending_market, // Market authority (derived)
                &self.kamino_obligation,
                &position_account_info,
                &self.clock,
                &self.token_program,
                lending_a,
            )?;
            
            self.position.token_a_in_lending = 0;
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_add(lending_a)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        // Withdraw token B from Kamino
        if lending_b > 0 {
            let source_collateral_b = self.kamino_reserve_b.to_account_info();
            
            self.position.withdraw_from_kamino_cpi(
                &position_account_info,
                &self.kamino_program.to_account_info(),
                &source_collateral_b,
                &self.position_token_b_vault,
                &self.kamino_reserve_b,
                &self.kamino_reserve_b, // Reserve liquidity supply
                &self.kamino_reserve_b, // Reserve collateral mint
                &self.kamino_lending_market,
                &self.kamino_lending_market, // Market authority (derived)
                &self.kamino_obligation,
                &position_account_info,
                &self.clock,
                &self.token_program,
                lending_b,
            )?;
            
            self.position.token_b_in_lending = 0;
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_add(lending_b)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        
        self.position.kamino_obligation = None;
        
        msg!("Successfully withdrew {} A and {} B from Kamino", lending_a, lending_b);
        Ok(())
    }
}

// Helper function to normalize Pyth prices to target decimals
pub fn normalize_pyth_price(price: i64, exponent: i32, target_decimals: u8) -> Result<u64> {
    if price <= 0 {
        return Err(ErrorCode::StalePriceData.into());
    }
    
    // Pyth exponents are negative for decimal places
    // e.g., exponent = -8 means 8 decimal places
    let pyth_decimals = (-exponent) as u8;
    
    let normalized_price = if pyth_decimals > target_decimals {
        // Need to reduce decimals
        let divisor = 10u64.pow((pyth_decimals - target_decimals) as u32);
        (price as u64) / divisor
    } else if pyth_decimals < target_decimals {
        // Need to add decimals
        let multiplier = 10u64.pow((target_decimals - pyth_decimals) as u32);
        (price as u64).checked_mul(multiplier).ok_or(ErrorCode::MathOverflow)?
    } else {
        // Same decimals
        price as u64
    };
    
    Ok(normalized_price)
}
