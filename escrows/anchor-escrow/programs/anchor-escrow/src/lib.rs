#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("7MPfV2Mgjj2bstkBVDSuq1v5314k161jGTZqTdsKYhtP");

#[program]
pub mod anchor_escrow {
    use anchor_lang::prelude::borsh::de;

    use super::*;

    pub fn initialize(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps);
        ctx.accounts.deposit(deposit);

        Ok(())
    }
}
