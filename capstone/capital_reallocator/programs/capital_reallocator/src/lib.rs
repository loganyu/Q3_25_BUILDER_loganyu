#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("6MfEgfgcnoGujn36FJCNoKecu7vCzXVX1K7Hu4qQdTKB");

#[program]
pub mod capital_reallocator {
    use super::*;

    pub fn initialize_protocol(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
