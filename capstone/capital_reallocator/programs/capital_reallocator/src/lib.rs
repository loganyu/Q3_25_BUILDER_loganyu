// lib.rs
#![allow(unexpected_cfgs, deprecated)]

use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod errors;
pub mod events;
pub mod constants;

use instructions::*;

declare_id!("6MfEgfgcnoGujn36FJCNoKecu7vCzXVX1K7Hu4qQdTKB");

#[program]
pub mod capital_reallocator {
    use super::*;

    // Protocol initialization
    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, fee_bps: u16) -> Result<()> {
        ctx.accounts.init_protocol(fee_bps, &ctx.bumps)
    }

    // User initialization
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        ctx.accounts.init_user(&ctx.bumps)
    }

    // Position management
    pub fn create_position(
        ctx: Context<CreatePosition>,
        position_id: u64,
        lp_range_min: u64,
        lp_range_max: u64,
    ) -> Result<()> {
        ctx.accounts.init_position(position_id, lp_range_min, lp_range_max, &ctx.bumps)
    }

    pub fn deposit_to_position(
        ctx: Context<DepositToPosition>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        ctx.accounts.deposit(amount_a, amount_b)
    }

    pub fn pause_position(ctx: Context<ModifyPosition>) -> Result<()> {
        ctx.accounts.pause()
    }

    pub fn resume_position(ctx: Context<ModifyPosition>) -> Result<()> {
        ctx.accounts.resume()
    }

    // Rebalancing operations
    pub fn check_position_status(ctx: Context<CheckPositionStatus>) -> Result<()> {
        ctx.accounts.check_status()
    }

    pub fn rebalance_position(ctx: Context<RebalancePosition>) -> Result<()> {
        ctx.accounts.rebalance()
    }

    pub fn rebalance_batch(
        ctx: Context<RebalanceBatch>,
        position_ids: Vec<u64>,
    ) -> Result<()> {
        ctx.accounts.rebalance_batch(position_ids)
    }

    // Withdrawal operations
    pub fn withdraw_from_position(
        ctx: Context<WithdrawFromPosition>,
        withdraw_percentage: u8,
    ) -> Result<()> {
        ctx.accounts.withdraw(withdraw_percentage)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        ctx.accounts.close()
    }
}
