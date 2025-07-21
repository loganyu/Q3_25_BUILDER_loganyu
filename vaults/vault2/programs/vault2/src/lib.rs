use anchor_lang::prelude::*;

declare_id!("ArXdRsT2zBK98eX6yMh2qMTPGgsLnG4hrXbX95ZjqeZ3");

#[program]
pub mod vault2 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
