use anchor_lang::prelude::*;

declare_id!("7MPfV2Mgjj2bstkBVDSuq1v5314k161jGTZqTdsKYhtP");

#[program]
pub mod anchor_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
