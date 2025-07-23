use anchor_lang::prelude::*;

declare_id!("6tUm5wq3ttg81FX7d93Bs4zssP35fj9KDacwnkxMveB9");

#[program]
pub mod escrow4 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
