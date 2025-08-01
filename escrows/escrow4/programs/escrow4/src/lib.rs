#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("6tUm5wq3ttg81FX7d93Bs4zssP35fj9KDacwnkxMveB9");

#[program]
pub mod escrow4 {
    use super::*;

    pub fn initialize(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps);
        ctx.accounts.deposit(deposit);
        Ok(())
    }

    pub fn take(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps);
        ctx.accounts.deposit(deposit);
        Ok(())
    }
}
