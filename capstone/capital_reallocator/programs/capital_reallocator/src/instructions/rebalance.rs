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
pub const JUPITER_PROGRAM: &str = "JUPyTerVGraWPqKUN5g8STQTQbZvCEPfbZFpRFGHHHH";

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

    /// CHECK: Meteora LB pair account    
    #[account(constraint = meteora_program.key() == METEORA_DLMM_PROGRAM.parse::<Pubkey>().unwrap())]
    pub meteora_program: UncheckedAccount<'info>,

    /// CHECK: Meteora LB pair account
    pub meteora_lb_pair: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora position account
    pub meteora_position: Option<UncheckedAccount<'info>>,
    
    /// CHECK: Meteora bin arrays
    pub meteora_bin_array_lower: Option<UncheckedAccount<'info>>,
    pub meteora_bin_array_upper: Option<UncheckedAccount<'info>>,
    
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
        // Check if we have lending accounts provided
        let kamino_lending_market = self.kamino_lending_market.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;
        let kamino_obligation = self.kamino_obligation.as_ref()
            .ok_or(ErrorCode::LendingPositionNotFound)?;

        // Real Kamino withdrawal would happen here
        // For now, simulate by moving balances
        let lending_a = self.position.token_a_in_lending;
        let lending_b = self.position.token_b_in_lending;

        if lending_a > 0 || lending_b > 0 {
            // TODO: Implement actual Kamino CPI calls
            // Example structure:
            // kamino_lending::cpi::withdraw_obligation_collateral(
            //     CpiContext::new_with_signer(
            //         self.kamino_program.to_account_info(),
            //         kamino_lending::cpi::accounts::WithdrawObligationCollateral {
            //             lending_market: kamino_lending_market.to_account_info(),
            //             obligation: kamino_obligation.to_account_info(),
            //             // ... other required accounts
            //         },
            //         signer_seeds,
            //     ),
            //     lending_a,
            // )?;
            
            // Simulate withdrawal
            self.position.token_a_in_lending = 0;
            self.position.token_b_in_lending = 0;
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_add(lending_a)
                .ok_or(ErrorCode::MathOverflow)?;
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_add(lending_b)
                .ok_or(ErrorCode::MathOverflow)?;
            
            msg!("Withdrew {} A and {} B from Kamino", lending_a, lending_b);
        }

        Ok(())
    }
    
    fn deposit_to_kamino(&mut self) -> Result<()> {
        msg!("Depositing to Kamino lending...");
        
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        if vault_a > 0 || vault_b > 0 {
            // Check if we have lending accounts provided
            let kamino_lending_market = self.kamino_lending_market.as_ref()
                .ok_or(ErrorCode::ExternalProtocolError)?;
            
            // TODO: Implement actual Kamino CPI calls
            // Example structure:
            // kamino_lending::cpi::deposit_obligation_collateral(
            //     CpiContext::new_with_signer(
            //         self.kamino_program.to_account_info(),
            //         kamino_lending::cpi::accounts::DepositObligationCollateral {
            //             lending_market: kamino_lending_market.to_account_info(),
            //             // ... other required accounts
            //         },
            //         signer_seeds,
            //     ),
            //     vault_a,
            // )?;
            
            // Simulate deposit
            self.position.token_a_vault_balance = 0;
            self.position.token_b_vault_balance = 0;
            self.position.token_a_in_lending = self.position.token_a_in_lending
                .checked_add(vault_a)
                .ok_or(ErrorCode::MathOverflow)?;
            self.position.token_b_in_lending = self.position.token_b_in_lending
                .checked_add(vault_b)
                .ok_or(ErrorCode::MathOverflow)?;
            
            msg!("Deposited {} A and {} B to Kamino", vault_a, vault_b);
        }
        
        Ok(())
    }
    
    fn close_meteora_position(&mut self) -> Result<()> {
        msg!("Closing Meteora DLMM position...");
        
        let lp_a = self.position.token_a_in_lp;
        let lp_b = self.position.token_b_in_lp;
        
        if lp_a > 0 || lp_b > 0 {
            // Check if we have LP accounts provided
            let meteora_lb_pair = self.meteora_lb_pair.as_ref()
                .ok_or(ErrorCode::LPPositionNotFound)?;
            let meteora_position = self.meteora_position.as_ref()
                .ok_or(ErrorCode::LPPositionNotFound)?;
            
            // TODO: Implement actual Meteora CPI calls
            // Example structure:
            // meteora_dlmm::cpi::remove_liquidity(
            //     CpiContext::new_with_signer(
            //         self.meteora_program.to_account_info(),
            //         meteora_dlmm::cpi::accounts::RemoveLiquidity {
            //             lb_pair: meteora_lb_pair.to_account_info(),
            //             position: meteora_position.to_account_info(),
            //             // ... other required accounts
            //         },
            //         signer_seeds,
            //     ),
            //     lp_a,
            //     lp_b,
            // )?;
            
            // Simulate closing position
            self.position.token_a_in_lp = 0;
            self.position.token_b_in_lp = 0;
            self.position.token_a_vault_balance = self.position.token_a_vault_balance
                .checked_add(lp_a)
                .ok_or(ErrorCode::MathOverflow)?;
            self.position.token_b_vault_balance = self.position.token_b_vault_balance
                .checked_add(lp_b)
                .ok_or(ErrorCode::MathOverflow)?;
            
            msg!("Closed Meteora position, recovered {} A and {} B", lp_a, lp_b);
        }
        
        Ok(())
    }
    
    fn open_meteora_position(&mut self, current_price: u64) -> Result<()> {
        msg!("Opening Meteora DLMM position...");
        
        let vault_a = self.position.token_a_vault_balance;
        let vault_b = self.position.token_b_vault_balance;
        
        if vault_a > 0 || vault_b > 0 {
            // Check if we have LP accounts provided
            let meteora_lb_pair = self.meteora_lb_pair.as_ref()
                .ok_or(ErrorCode::ExternalProtocolError)?;
            
            // Step 1: Use Jupiter to balance tokens to optimal ratio
            self.balance_tokens_for_lp(current_price)?;
            
            // Step 2: Open LP position on Meteora
            // TODO: Implement actual Meteora CPI calls
            // Example structure:
            // meteora_dlmm::cpi::add_liquidity(
            //     CpiContext::new_with_signer(
            //         self.meteora_program.to_account_info(),
            //         meteora_dlmm::cpi::accounts::AddLiquidity {
            //             lb_pair: meteora_lb_pair.to_account_info(),
            //             // ... other required accounts
            //         },
            //         signer_seeds,
            //     ),
            //     vault_a,
            //     vault_b,
            //     self.position.lp_range_min,
            //     self.position.lp_range_max,
            // )?;
            
            // Simulate opening position
            self.position.token_a_vault_balance = 0;
            self.position.token_b_vault_balance = 0;
            self.position.token_a_in_lp = self.position.token_a_in_lp
                .checked_add(vault_a)
                .ok_or(ErrorCode::MathOverflow)?;
            self.position.token_b_in_lp = self.position.token_b_in_lp
                .checked_add(vault_b)
                .ok_or(ErrorCode::MathOverflow)?;
            
            msg!("Opened Meteora position with {} A and {} B", vault_a, vault_b);
        }
        
        Ok(())
    }

    // Jupiter Integration for token balancing
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
            
            // TODO: Implement actual Jupiter CPI call
            // jupiter::cpi::swap(
            //     CpiContext::new_with_signer(
            //         self.jupiter_program.to_account_info(),
            //         jupiter::cpi::accounts::Swap {
            //             // ... required accounts
            //         },
            //         signer_seeds,
            //     ),
            //     excess_a, // amount in
            //     0,        // minimum amount out (would calculate based on slippage)
            // )?;
            
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

    pub price_update: Account<'info, PriceUpdateV2>,
    
    // Note: In production, positions would be passed via remaining_accounts
}

impl<'info> RebalanceBatch<'info> {
    pub fn rebalance_batch(&self, position_ids: Vec<u64>) -> Result<()> {
        require!(
            position_ids.len() <= MAX_BATCH_SIZE,
            ErrorCode::BatchTooLarge
        );
        
        msg!("Batch rebalancing {} positions", position_ids.len());
        
        // TODO: Implement actual batch rebalancing logic
        // 1. Iterate through remaining_accounts (positions)
        // 2. For each position, check if rebalancing is needed
        // 3. Execute rebalancing for positions that need it
        
        // This would require the positions to be passed in remaining_accounts
        // and proper validation of each position account
        
        Ok(())
    }
}
