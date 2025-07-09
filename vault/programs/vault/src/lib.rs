use anchor_lang::prelude::*;

declare_id!("A9AQD2Lr4JsUTie3kQcwm1crN4AvyGnbBkv4cxURQszj");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
