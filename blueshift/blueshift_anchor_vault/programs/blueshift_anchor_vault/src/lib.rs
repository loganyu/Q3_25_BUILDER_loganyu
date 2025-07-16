use anchor_lang::prelude::*;

declare_id!("2qjDmXz9UjZG98VT92ii4j353Tor6knwLip8wrbQbwDV");

#[program]
pub mod blueshift_anchor_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
