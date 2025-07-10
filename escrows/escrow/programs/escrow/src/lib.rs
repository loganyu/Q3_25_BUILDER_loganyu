#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;

mod instructions;
use instructions::*;

declare_id!("813Q7rghNmfQorYoXnsQYmDn3PNRP3RD5ivwYP4tvWir");

#[program]
pub mod escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit(deposit)?;
        ctx.accounts.withdraw_and_close_vault()?;
        Ok(())
    }
}
