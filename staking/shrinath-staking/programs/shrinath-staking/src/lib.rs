use anchor_lang::prelude::*;

declare_id!("qtFGSCwQDJu9YiEEVaUKBEd1WP2JL6tRFYCeZtktmJg");

#[program]
pub mod shrinath_staking {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
