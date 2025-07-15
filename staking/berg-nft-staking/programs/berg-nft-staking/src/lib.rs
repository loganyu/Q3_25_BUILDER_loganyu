use anchor_lang::prelude::*;

declare_id!("D3iKQB5m1YuZZJkqbK89dBfv57kp1x3tB27nhn4fbXtu");

#[program]
pub mod berg_nft_staking {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
