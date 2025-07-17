#![allow(unexpected_cfgs, deprecated)]

use anchor_lang::prelude::*;

pub mod context;
pub mod state;

use context::*;
use state::*;

declare_id!("9QY6zZVt9hQHR3skYtadx4X98CPr8J9tUYdFpDpHe7mu");

#[program]
pub mod berg_marketplace {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
