#![allow(unexpected_cfgs, deprecated)]

use anchor_lang::prelude::*;

mod instructions;
mod state;

use instructions::*;
use state::*;


declare_id!("E7F9bT8pUiuG8nkfF3KQqeTe6czCRGd7ES4xMPeGv396");

#[program]
pub mod amm2 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}
