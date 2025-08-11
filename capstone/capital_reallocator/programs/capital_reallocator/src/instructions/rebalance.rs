// instructions/rebalance.rs
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};
use crate::state::*;
use crate::errors::ErrorCode;
use crate::events::{PositionStatusEvent, RebalanceEvent, RebalanceAction};
use crate::constants::*;

pub const SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// Check Position Status
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

// Rebalance Position
#[derive(Accounts)]
pub struct RebalancePosition<'info> {
    #[account(
        mut,
        seeds = [POSITION_SEED, position.owner.as_ref(), position.position_id.to_le_bytes().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, Position>,
    
    pub price_update: Account<'info, PriceUpdateV2>,
    
    /// CHECK: Meteora DLMM program
    pub meteora_program: UncheckedAccount<'info>,
    
    /// CHECK: Kamino lending program
    pub kamino_program: UncheckedAccount<'info>,
    
    /// CHECK: Jupiter aggregator program
    pub jupiter_program: UncheckedAccount<'info>,
    
    // Additional accounts would be needed for actual CPI calls
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

impl<'info> RebalancePosition<'info> {
    pub fn rebalance(&mut self) -> Result<()> {
        // Check if position is paused
        require!(!self.position.pause_flag, ErrorCode::PositionPaused);

        // Get price from Pyth
        let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)?;
        let maximum_age: u64 = 30; // 30 seconds max staleness

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
                self.withdraw_from_lending()?;
                self.open_lp_position(current_price)?;
                Ok(RebalanceAction::MoveToLP)
            } else if has_idle {
                msg!("Deploying idle funds to LP");
                self.open_lp_position(current_price)?;
                Ok(RebalanceAction::MoveToLP)
            } else {
                Ok(RebalanceAction::NoAction)
            }
        } else {
            if has_lp {
                msg!("Moving from LP to lending");
                self.close_lp_position()?;
                self.deposit_to_lending()?;
                Ok(RebalanceAction::MoveToLending)
            } else if has_idle {
                msg!("Deploying idle funds to lending");
                self.deposit_to_lending()?;
                Ok(RebalanceAction::MoveToLending)
            } else {
                Ok(RebalanceAction::NoAction)
            }
        }
    }
    
    fn withdraw_from_lending(&mut self) -> Result<()> {
        // In production: Call Kamino withdraw CPI here
        // For now, simulate by moving balances
        let lending_a = self.position.token_a_in_lending;
        let lending_b = self.position.token_b_in_lending;
        
        self.position.token_a_in_lending = 0;
        self.position.token_b_in_lending = 0;
        self.position.token_a_vault_balance = self.position.token_a_vault_balance
            .checked_add(lending_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.position.token_b_vault_balance = self.position.token_b_vault_balance
            .checked_add(lending_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Withdrew {} A and {} B from lending", lending_a, lending_b);
        Ok(())
    }
    
    fn deposit_to_lending(&mut self) -> Result<()> {
        // In production: Call Kamino deposit CPI here
        // For now, simulate by moving balances
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        self.position.token_a_vault_balance = 0;
        self.position.token_b_vault_balance = 0;
        self.position.token_a_in_lending = self.position.token_a_in_lending
            .checked_add(vault_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.position.token_b_in_lending = self.position.token_b_in_lending
            .checked_add(vault_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Deposited {} A and {} B to lending", vault_a, vault_b);
        Ok(())
    }
    
    fn close_lp_position(&mut self) -> Result<()> {
        // In production: Call Meteora close position CPI here
        // For now, simulate by moving balances
        let lp_a = self.position.token_a_in_lp;
        let lp_b = self.position.token_b_in_lp;
        
        self.position.token_a_in_lp = 0;
        self.position.token_b_in_lp = 0;
        self.position.token_a_vault_balance = self.position.token_a_vault_balance
            .checked_add(lp_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.position.token_b_vault_balance = self.position.token_b_vault_balance
            .checked_add(lp_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Closed LP position, recovered {} A and {} B", lp_a, lp_b);
        Ok(())
    }
    
    fn open_lp_position(&mut self, _current_price: u64) -> Result<()> {
        // In production: 
        // 1. Call Jupiter swap CPI to get 50/50 ratio
        // 2. Call Meteora open position CPI
        // For now, simulate by moving balances
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        // Simple simulation - in reality would calculate based on price
        self.position.token_a_vault_balance = 0;
        self.position.token_b_vault_balance = 0;
        self.position.token_a_in_lp = self.position.token_a_in_lp
            .checked_add(vault_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.position.token_b_in_lp = self.position.token_b_in_lp
            .checked_add(vault_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Opened LP position with {} A and {} B", vault_a, vault_b);
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

// Batch Rebalance
#[derive(Accounts)]
pub struct RebalanceBatch<'info> {
    #[account(
        seeds = [KEEPER_SEED],
        bump
    )]
    /// CHECK: Keeper authority PDA
    pub keeper_authority: UncheckedAccount<'info>,
    
    pub keeper: Signer<'info>,
    
    // In production, you'd need remaining_accounts for all positions
}

impl<'info> RebalanceBatch<'info> {
    pub fn rebalance_batch(&self, position_ids: Vec<u64>) -> Result<()> {
        require!(
            position_ids.len() <= MAX_BATCH_SIZE,
            ErrorCode::BatchTooLarge
        );
        
        msg!("Batch rebalancing {} positions", position_ids.len());
        
        // In a real implementation, this would iterate through positions
        // using remaining_accounts and perform rebalancing
        // For now, we'll just validate the keeper
        
        // TODO: Implement actual batch rebalancing logic
        // 1. Iterate through remaining_accounts
        // 2. Validate each position
        // 3. Perform rebalancing for each position
        
        Ok(())
    }
}
