import { Test } from '@nestjs/testing'
import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../../app.module'

describe('Auth guard smoke', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects unauthenticated /projects', () => {
    return request(app.getHttpServer()).get('/projects').expect(401)
  })
})
