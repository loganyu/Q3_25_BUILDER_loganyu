// protocols/kamino.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use crate::state::Position;
use crate::errors::ErrorCode;

// Kamino Lending Program ID (mainnet/devnet)
pub const KAMINO_LENDING_PROGRAM_ID: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

// Kamino instruction discriminators (from their IDL)
pub const INIT_OBLIGATION_DISCRIMINATOR: [u8; 8] = [251, 10, 231, 76, 27, 11, 159, 11];
pub const REFRESH_RESERVE_DISCRIMINATOR: [u8; 8] = [22, 92, 237, 58, 232, 143, 59, 3];
pub const REFRESH_OBLIGATION_DISCRIMINATOR: [u8; 8] = [47, 150, 196, 182, 26, 27, 203, 13];
pub const DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR: [u8; 8] = [216, 144, 179, 156, 20, 27, 14, 73];
pub const REDEEM_RESERVE_COLLATERAL_DISCRIMINATOR: [u8; 8] = [30, 241, 52, 195, 5, 91, 199, 245];
pub const DEPOSIT_OBLIGATION_COLLATERAL_DISCRIMINATOR: [u8; 8] = [179, 184, 11, 107, 133, 238, 98, 248];
pub const WITHDRAW_OBLIGATION_COLLATERAL_DISCRIMINATOR: [u8; 8] = [176, 105, 7, 141, 193, 120, 84, 88];

// Kamino Reserve Configuration
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReserveConfig {
    pub optimal_utilization_rate: u8,
    pub loan_to_value_ratio: u8,
    pub liquidation_bonus: u8,
    pub liquidation_threshold: u8,
    pub min_borrow_rate: u8,
    pub optimal_borrow_rate: u8,
    pub max_borrow_rate: u8,
    pub fees: ReserveFees,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReserveFees {
    pub borrow_fee_wad: u64,
    pub flash_loan_fee_wad: u64,
    pub host_fee_percentage: u8,
}

// Kamino Obligation structure (simplified)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ObligationCollateral {
    pub deposit_reserve: Pubkey,
    pub deposited_amount: u64,
    pub market_value: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ObligationLiquidity {
    pub borrow_reserve: Pubkey,
    pub cumulative_borrow_rate_wads: u128,
    pub borrowed_amount_wads: u128,
    pub market_value: u128,
}

// Helper functions for Kamino integration
impl Position {
    /// Initialize a Kamino obligation for the position
    pub fn init_kamino_obligation_cpi<'info>(
        &mut self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        obligation: &AccountInfo<'info>,
        owner: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        rent: &Sysvar<'info, Rent>,
        token_program: &Program<'info, Token>,
    ) -> Result<()> {
        msg!("Initializing Kamino obligation...");
        
        // Build instruction data
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&INIT_OBLIGATION_DISCRIMINATOR);
        
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
            AccountMeta::new(obligation.key(), false),
            AccountMeta::new_readonly(lending_market.key(), false),
            AccountMeta::new_readonly(owner.key(), true),
            AccountMeta::new_readonly(clock.key(), false),
            AccountMeta::new_readonly(rent.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        // Execute CPI
        invoke_signed(
            &instruction,
            &[
                obligation.clone(),
                lending_market.clone(),
                position_account_info.clone(),
                clock.to_account_info(),
                rent.to_account_info(),
                token_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // Store obligation reference
        self.kamino_obligation = Some(obligation.key());
        
        msg!("Kamino obligation initialized");
        Ok(())
    }
    
    /// Deposit tokens to Kamino lending
    pub fn deposit_to_kamino_cpi<'info>(
        &mut self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        source_liquidity: &Account<'info, TokenAccount>,
        destination_collateral: &AccountInfo<'info>,
        reserve: &AccountInfo<'info>,
        reserve_liquidity_supply: &AccountInfo<'info>,
        reserve_collateral_mint: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        lending_market_authority: &AccountInfo<'info>,
        obligation: &AccountInfo<'info>,
        owner: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        token_program: &Program<'info, Token>,
        liquidity_amount: u64,
    ) -> Result<()> {
        msg!("Depositing {} to Kamino lending...", liquidity_amount);
        
        // First, refresh the reserve
        self.refresh_kamino_reserve_cpi(
            kamino_program,
            reserve,
            clock,
        )?;
        
        // Build deposit instruction data
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR);
        liquidity_amount.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        // Build account metas for deposit
        let account_metas = vec![
            AccountMeta::new(source_liquidity.key(), false),
            AccountMeta::new(destination_collateral.key(), false),
            AccountMeta::new(reserve.key(), false),
            AccountMeta::new(reserve_liquidity_supply.key(), false),
            AccountMeta::new(reserve_collateral_mint.key(), false),
            AccountMeta::new_readonly(lending_market.key(), false),
            AccountMeta::new_readonly(lending_market_authority.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true),
            AccountMeta::new_readonly(clock.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        // Execute deposit CPI
        invoke_signed(
            &instruction,
            &[
                source_liquidity.to_account_info(),
                destination_collateral.clone(),
                reserve.clone(),
                reserve_liquidity_supply.clone(),
                reserve_collateral_mint.clone(),
                lending_market.clone(),
                lending_market_authority.clone(),
                position_account_info.clone(),
                clock.to_account_info(),
                token_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // Now deposit the collateral to the obligation
        self.deposit_obligation_collateral_cpi(
            position_account_info,
            kamino_program,
            destination_collateral,
            reserve_collateral_mint,
            reserve,
            obligation,
            lending_market,
            owner,
            clock,
            token_program,
            liquidity_amount,
        )?;
        
        msg!("Successfully deposited {} to Kamino", liquidity_amount);
        Ok(())
    }
    
    /// Withdraw tokens from Kamino lending
    pub fn withdraw_from_kamino_cpi<'info>(
        &mut self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        source_collateral: &AccountInfo<'info>,
        destination_liquidity: &Account<'info, TokenAccount>,
        reserve: &AccountInfo<'info>,
        reserve_liquidity_supply: &AccountInfo<'info>,
        reserve_collateral_mint: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        lending_market_authority: &AccountInfo<'info>,
        obligation: &AccountInfo<'info>,
        owner: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        token_program: &Program<'info, Token>,
        collateral_amount: u64,
    ) -> Result<()> {
        msg!("Withdrawing {} from Kamino lending...", collateral_amount);
        
        // First, withdraw collateral from obligation
        self.withdraw_obligation_collateral_cpi(
            position_account_info,
            kamino_program,
            source_collateral,
            reserve,
            obligation,
            lending_market,
            lending_market_authority,
            owner,
            clock,
            token_program,
            collateral_amount,
        )?;
        
        // Then redeem the collateral for liquidity
        self.redeem_reserve_collateral_cpi(
            position_account_info,
            kamino_program,
            source_collateral,
            destination_liquidity,
            reserve,
            reserve_collateral_mint,
            reserve_liquidity_supply,
            lending_market,
            lending_market_authority,
            clock,
            token_program,
            collateral_amount,
        )?;
        
        msg!("Successfully withdrew {} from Kamino", collateral_amount);
        Ok(())
    }
    
    // Private helper methods
    fn refresh_kamino_reserve_cpi<'info>(
        &self,
        kamino_program: &AccountInfo<'info>,
        reserve: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
    ) -> Result<()> {
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&REFRESH_RESERVE_DISCRIMINATOR);
        
        let account_metas = vec![
            AccountMeta::new(reserve.key(), false),
            AccountMeta::new_readonly(clock.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        invoke_signed(
            &instruction,
            &[
                reserve.clone(),
                clock.to_account_info(),
            ],
            &[],
        )?;
        
        Ok(())
    }
    
    fn deposit_obligation_collateral_cpi<'info>(
        &self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        source_collateral: &AccountInfo<'info>,
        reserve_collateral_mint: &AccountInfo<'info>,
        reserve: &AccountInfo<'info>,
        obligation: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        owner: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        token_program: &Program<'info, Token>,
        collateral_amount: u64,
    ) -> Result<()> {
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&DEPOSIT_OBLIGATION_COLLATERAL_DISCRIMINATOR);
        collateral_amount.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        let account_metas = vec![
            AccountMeta::new(source_collateral.key(), false),
            AccountMeta::new_readonly(reserve_collateral_mint.key(), false),
            AccountMeta::new_readonly(reserve.key(), false),
            AccountMeta::new(obligation.key(), false),
            AccountMeta::new_readonly(lending_market.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true),
            AccountMeta::new_readonly(clock.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        invoke_signed(
            &instruction,
            &[
                source_collateral.clone(),
                reserve_collateral_mint.clone(),
                reserve.clone(),
                obligation.clone(),
                lending_market.clone(),
                position_account_info.clone(),
                clock.to_account_info(),
                token_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        Ok(())
    }
    
    fn withdraw_obligation_collateral_cpi<'info>(
        &self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        destination_collateral: &AccountInfo<'info>,
        reserve: &AccountInfo<'info>,
        obligation: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        lending_market_authority: &AccountInfo<'info>,
        owner: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        token_program: &Program<'info, Token>,
        collateral_amount: u64,
    ) -> Result<()> {
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&WITHDRAW_OBLIGATION_COLLATERAL_DISCRIMINATOR);
        collateral_amount.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        let account_metas = vec![
            AccountMeta::new(destination_collateral.key(), false),
            AccountMeta::new_readonly(reserve.key(), false),
            AccountMeta::new(obligation.key(), false),
            AccountMeta::new_readonly(lending_market.key(), false),
            AccountMeta::new_readonly(lending_market_authority.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true),
            AccountMeta::new_readonly(clock.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        invoke_signed(
            &instruction,
            &[
                destination_collateral.clone(),
                reserve.clone(),
                obligation.clone(),
                lending_market.clone(),
                lending_market_authority.clone(),
                position_account_info.clone(),
                clock.to_account_info(),
                token_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        Ok(())
    }
    
    fn redeem_reserve_collateral_cpi<'info>(
        &self,
        position_account_info: &AccountInfo<'info>,
        kamino_program: &AccountInfo<'info>,
        source_collateral: &AccountInfo<'info>,
        destination_liquidity: &Account<'info, TokenAccount>,
        reserve: &AccountInfo<'info>,
        reserve_collateral_mint: &AccountInfo<'info>,
        reserve_liquidity_supply: &AccountInfo<'info>,
        lending_market: &AccountInfo<'info>,
        lending_market_authority: &AccountInfo<'info>,
        clock: &Sysvar<'info, Clock>,
        token_program: &Program<'info, Token>,
        collateral_amount: u64,
    ) -> Result<()> {
        let mut instruction_data = Vec::new();
        instruction_data.extend_from_slice(&REDEEM_RESERVE_COLLATERAL_DISCRIMINATOR);
        collateral_amount.serialize(&mut instruction_data)?;
        
        // Create position signer seeds
        let position_id_bytes = self.position_id.to_le_bytes();
        let position_seeds = &[
            b"position",
            self.owner.as_ref(),
            position_id_bytes.as_ref(),
            &[self.bump],
        ];
        let signer_seeds = &[&position_seeds[..]];
        
        let account_metas = vec![
            AccountMeta::new(source_collateral.key(), false),
            AccountMeta::new(destination_liquidity.key(), false),
            AccountMeta::new(reserve.key(), false),
            AccountMeta::new(reserve_collateral_mint.key(), false),
            AccountMeta::new(reserve_liquidity_supply.key(), false),
            AccountMeta::new_readonly(lending_market.key(), false),
            AccountMeta::new_readonly(lending_market_authority.key(), false),
            AccountMeta::new_readonly(position_account_info.key(), true),
            AccountMeta::new_readonly(clock.key(), false),
            AccountMeta::new_readonly(token_program.key(), false),
        ];
        
        let instruction = Instruction {
            program_id: KAMINO_LENDING_PROGRAM_ID,
            accounts: account_metas,
            data: instruction_data,
        };
        
        invoke_signed(
            &instruction,
            &[
                source_collateral.clone(),
                destination_liquidity.to_account_info(),
                reserve.clone(),
                reserve_collateral_mint.clone(),
                reserve_liquidity_supply.clone(),
                lending_market.clone(),
                lending_market_authority.clone(),
                position_account_info.clone(),
                clock.to_account_info(),
                token_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        Ok(())
    }
}

// Mock implementations for testing
#[cfg(test)]
pub mod mock {
    use super::*;
    
    pub struct MockKaminoReserve {
        pub pubkey: Pubkey,
        pub liquidity_mint: Pubkey,
        pub collateral_mint: Pubkey,
        pub liquidity_supply: Pubkey,
        pub available_liquidity: u64,
        pub borrowed_amount: u64,
    }
    
    impl MockKaminoReserve {
        pub fn new(liquidity_mint: Pubkey) -> Self {
            Self {
                pubkey: Pubkey::new_unique(),
                liquidity_mint,
                collateral_mint: Pubkey::new_unique(),
                liquidity_supply: Pubkey::new_unique(),
                available_liquidity: 1_000_000 * 10u64.pow(6), // 1M tokens
                borrowed_amount: 0,
            }
        }
    }
    
    pub struct MockKaminoObligation {
        pub pubkey: Pubkey,
        pub owner: Pubkey,
        pub lending_market: Pubkey,
        pub deposits: Vec<ObligationCollateral>,
        pub borrows: Vec<ObligationLiquidity>,
    }
    
    impl MockKaminoObligation {
        pub fn new(owner: Pubkey, lending_market: Pubkey) -> Self {
            Self {
                pubkey: Pubkey::new_unique(),
                owner,
                lending_market,
                deposits: Vec::new(),
                borrows: Vec::new(),
            }
        }
    }
}
