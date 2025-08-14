// protocols/meteora.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use crate::state::Position;
use crate::errors::ErrorCode;

// Meteora DLMM Program ID
pub const METEORA_DLMM_PROGRAM_ID: Pubkey = pubkey!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

// Meteora instruction discriminators (from their IDL)
pub const ADD_LIQUIDITY_BY_STRATEGY_DISCRIMINATOR: [u8; 8] = [158, 20, 230, 72, 165, 58, 72, 82];
pub const REMOVE_LIQUIDITY_DISCRIMINATOR: [u8; 8] = [80, 85, 209, 72, 24, 206, 177, 108];
pub const INITIALIZE_POSITION_DISCRIMINATOR: [u8; 8] = [95, 180, 10, 172, 84, 174, 232, 40];

// Meteora Strategy Types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum StrategyType {
    Spot,
    BidAsk,
    Curve,
}

// Meteora Strategy Parameters
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StrategyParameters {
    pub min_bin_id: i32,
    pub max_bin_id: i32,
    pub strategy_type: StrategyType,
}

// Meteora LiquidityParameter for add_liquidity_by_strategy
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LiquidityParameter {
    pub amount_x: u64,
    pub amount_y: u64,
    pub bin_liquidity_dist: Vec<BinLiquidityDistribution>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BinLiquidityDistribution {
    pub bin_id: i32,
    pub distribution_x: u16,
    pub distribution_y: u16,
}

// Helper functions for Meteora integration
impl Position {
    pub fn open_meteora_position_cpi<'info>(
        &mut self,
        position_account_info: &AccountInfo<'info>,
        meteora_program: &AccountInfo<'info>,
        lb_pair: &AccountInfo<'info>,
        meteora_position: &AccountInfo<'info>,
        position_token_a_vault: &Account<'info, TokenAccount>,
        position_token_b_vault: &Account<'info, TokenAccount>,
        meteora_reserve_x: &AccountInfo<'info>,
        meteora_reserve_y: &AccountInfo<'info>,
        token_a_mint: &Account<'info, Mint>,
        token_b_mint: &Account<'info, Mint>,
        meteora_bin_array_lower: &AccountInfo<'info>,
        meteora_bin_array_upper: &AccountInfo<'info>,
        token_program: &Program<'info, Token>,
        system_program: &Program<'info, System>,
        rent: &Sysvar<'info, Rent>,
        event_authority: &AccountInfo<'info>,
        amount_x: u64,
        amount_y: u64,
        current_price: u64,
    ) -> Result<()> {
        msg!("Opening Meteora DLMM position with CPI...");
        
        // Calculate bin range based on stored LP range
        let (min_bin_id, max_bin_id) = calculate_meteora_bin_range(
            current_price,
            self.lp_range_min,
            self.lp_range_max,
            25, // 0.25% bin step - typical for most pairs
        )?;
        
        msg!("Meteora bin range: {} to {}", min_bin_id, max_bin_id);
        msg!("Adding liquidity: {} token X, {} token Y", amount_x, amount_y);
        
        // Create liquidity distribution (simplified - single bin for now)
        let bin_liquidity_dist = vec![BinLiquidityDistribution {
            bin_id: (min_bin_id + max_bin_id) / 2, // Middle bin
            distribution_x: 10000, // 100% (basis points)
            distribution_y: 10000, // 100% (basis points)
        }];
        
        let liquidity_param = LiquidityParameter {
            amount_x,
            amount_y,
            bin_liquidity_dist,
        };
        
        // Build instruction data
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&ADD_LIQUIDITY_BY_STRATEGY_DISCRIMINATOR);
        liquidity_param.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        // Build account metas for CPI
        let account_metas = vec![
            AccountMeta::new_readonly(lb_pair.key(), false),
            AccountMeta::new(meteora_position.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true), // position authority
            AccountMeta::new(position_token_a_vault.key(), false),
            AccountMeta::new(position_token_b_vault.key(), false),
            AccountMeta::new(meteora_reserve_x.key(), false),
            AccountMeta::new(meteora_reserve_y.key(), false),
            AccountMeta::new_readonly(token_a_mint.key(), false),
            AccountMeta::new_readonly(token_b_mint.key(), false),
            AccountMeta::new(meteora_bin_array_lower.key(), false),
            AccountMeta::new(meteora_bin_array_upper.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new_readonly(system_program.key(), false),
            AccountMeta::new_readonly(rent.key(), false),
            AccountMeta::new_readonly(event_authority.key(), false),
            AccountMeta::new_readonly(meteora_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: METEORA_DLMM_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        // Execute CPI using invoke_signed
        invoke_signed(
            &instruction,
            &[
                lb_pair.clone(),
                meteora_position.clone(),
                position_account_info.clone(),
                position_token_a_vault.to_account_info(),
                position_token_b_vault.to_account_info(),
                meteora_reserve_x.clone(),
                meteora_reserve_y.clone(),
                token_a_mint.to_account_info(),
                token_b_mint.to_account_info(),
                meteora_bin_array_lower.clone(),
                meteora_bin_array_upper.clone(),
                token_program.to_account_info(),
                system_program.to_account_info(),
                rent.to_account_info(),
                event_authority.clone(),
                meteora_program.clone(),
            ],
            signer_seeds,
        )?;
        
        // Update position tracking
        self.token_a_vault_balance = self.token_a_vault_balance
            .checked_sub(amount_x)
            .ok_or(ErrorCode::MathOverflow)?;
        self.token_b_vault_balance = self.token_b_vault_balance
            .checked_sub(amount_y)
            .ok_or(ErrorCode::MathOverflow)?;
        self.token_a_in_lp = self.token_a_in_lp
            .checked_add(amount_x)
            .ok_or(ErrorCode::MathOverflow)?;
        self.token_b_in_lp = self.token_b_in_lp
            .checked_add(amount_y)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Successfully opened Meteora position");
        Ok(())
    }
    
    pub fn close_meteora_position_cpi<'info>(
        &mut self,
        position_account_info: &AccountInfo<'info>,
        meteora_program: &AccountInfo<'info>,
        lb_pair: &AccountInfo<'info>,
        meteora_position: &AccountInfo<'info>,
        position_token_a_vault: &Account<'info, TokenAccount>,
        position_token_b_vault: &Account<'info, TokenAccount>,
        meteora_reserve_x: &AccountInfo<'info>,
        meteora_reserve_y: &AccountInfo<'info>,
        token_a_mint: &Account<'info, Mint>,
        token_b_mint: &Account<'info, Mint>,
        meteora_bin_array_lower: &AccountInfo<'info>,
        meteora_bin_array_upper: &AccountInfo<'info>,
        token_program: &Program<'info, Token>,
        event_authority: &AccountInfo<'info>,
    ) -> Result<()> {
        msg!("Closing Meteora DLMM position with CPI...");
        
        let lp_amount_a = self.token_a_in_lp;
        let lp_amount_b = self.token_b_in_lp;
        
        if lp_amount_a == 0 && lp_amount_b == 0 {
            msg!("No liquidity to remove from Meteora");
            return Ok(());
        }
        
        // Remove 100% of liquidity parameters
        let bin_ids_to_remove = vec![0i32]; // This would be determined by position data
        let liquidity_bps_to_remove = vec![10000u16]; // 100% (basis points)
        let should_claim_and_close = true;
        
        // Build instruction data
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&REMOVE_LIQUIDITY_DISCRIMINATOR);
        bin_ids_to_remove.serialize(&mut instruction_data)?;
        liquidity_bps_to_remove.serialize(&mut instruction_data)?;
        should_claim_and_close.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        // Build account metas for CPI
        let account_metas = vec![
            AccountMeta::new(meteora_position.key(), false),
            AccountMeta::new_readonly(lb_pair.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true), // position authority
            AccountMeta::new(position_token_a_vault.key(), false),
            AccountMeta::new(position_token_b_vault.key(), false),
            AccountMeta::new(meteora_reserve_x.key(), false),
            AccountMeta::new(meteora_reserve_y.key(), false),
            AccountMeta::new_readonly(token_a_mint.key(), false),
            AccountMeta::new_readonly(token_b_mint.key(), false),
            AccountMeta::new(meteora_bin_array_lower.key(), false),
            AccountMeta::new(meteora_bin_array_upper.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
            AccountMeta::new_readonly(event_authority.key(), false),
            AccountMeta::new_readonly(meteora_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: METEORA_DLMM_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        // Execute CPI using invoke_signed
        invoke_signed(
            &instruction,
            &[
                meteora_position.clone(),
                lb_pair.clone(),
                position_account_info.clone(),
                position_token_a_vault.to_account_info(),
                position_token_b_vault.to_account_info(),
                meteora_reserve_x.clone(),
                meteora_reserve_y.clone(),
                token_a_mint.to_account_info(),
                token_b_mint.to_account_info(),
                meteora_bin_array_lower.clone(),
                meteora_bin_array_upper.clone(),
                token_program.to_account_info(),
                event_authority.clone(),
                meteora_program.clone(),
            ],
            signer_seeds,
        )?;
        
        // Update position tracking
        self.token_a_in_lp = 0;
        self.token_b_in_lp = 0;
        self.token_a_vault_balance = self.token_a_vault_balance
            .checked_add(lp_amount_a)
            .ok_or(ErrorCode::MathOverflow)?;
        self.token_b_vault_balance = self.token_b_vault_balance
            .checked_add(lp_amount_b)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Successfully closed Meteora position, recovered {} A and {} B", lp_amount_a, lp_amount_b);
        Ok(())
    }
}

// Helper function for bin range calculation
pub fn calculate_meteora_bin_range(
    current_price: u64,
    range_min: u64,
    range_max: u64,
    bin_step: u16,
) -> Result<(i32, i32)> {
    // Simplified bin calculation - in production you'd use Meteora's price conversion functions
    let base_bin_id = 8388608i32; // Middle bin ID (represents price = 1.0)
    
    // Calculate price ratios
    let min_ratio = (range_min as f64) / (current_price as f64);
    let max_ratio = (range_max as f64) / (current_price as f64);
    
    // Convert to bin IDs (simplified calculation)
    let bins_per_doubling = (10000.0 / bin_step as f64) as i32;
    let min_bin_offset = (min_ratio.ln() / 2f64.ln() * bins_per_doubling as f64) as i32;
    let max_bin_offset = (max_ratio.ln() / 2f64.ln() * bins_per_doubling as f64) as i32;
    
    let min_bin_id = base_bin_id + min_bin_offset;
    let max_bin_id = base_bin_id + max_bin_offset;
    
    Ok((min_bin_id, max_bin_id))
}
